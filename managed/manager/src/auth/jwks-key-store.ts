import { importJWK, type JWK } from "jose"
import { z } from "zod"
import type { Clock } from "../clock.js"
import { AuthenticationError, AuthenticationFailure } from "./authentication-error.js"

const JWKS_CACHE_MILLISECONDS = 300_000
const JWKS_GRACE_MILLISECONDS = 900_000
const UNKNOWN_KID_CAPACITY = 256
const UNKNOWN_KID_TTL_MILLISECONDS = 30_000
const REFRESH_LIMIT = 6
const REFRESH_WINDOW_MILLISECONDS = 60_000
const RSA_MODULUS_MINIMUM_BITS = 2_048
const RSA_MODULUS_MAXIMUM_BITS = 8_192
const RSA_EXPONENT_MAXIMUM_BYTES = 4

const WireRsaJwkShape = {
  alg: z.literal("RS256"),
  e: z.string().regex(/^[A-Za-z0-9_-]+$/u),
  kid: z.string().min(1).max(256),
  kty: z.literal("RSA"),
  n: z.string().regex(/^[A-Za-z0-9_-]+$/u),
  use: z.literal("sig"),
} as const

export const WireRsaJwkSchema = z.object(WireRsaJwkShape).strict().readonly()

export const RsaJwkSchema = z
  .object({
    ...WireRsaJwkShape,
    notAfterMilliseconds: z.number().int().positive().safe(),
  })
  .strict()
  .superRefine((jwk, context) => {
    if (!validModulus(jwk.n)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "RSA modulus rejected" })
    }
    if (!validExponent(jwk.e)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "RSA exponent rejected" })
    }
  })
  .readonly()
export type RsaJwk = z.infer<typeof RsaJwkSchema>

export interface JwksFetcher {
  fetch(): Promise<readonly RsaJwk[]>
}

type KeyStoreOptions = {
  readonly clock: Clock
  readonly fetcher: JwksFetcher
}

type VerificationKey = Awaited<ReturnType<typeof importJWK>>

type CachedKey = {
  readonly key: VerificationKey
  readonly kid: string
  readonly validUntil: number
}

export class UnknownKidCache {
  private readonly entries = new Map<string, number>()

  public constructor(private readonly clock: Clock) {}

  public has(kid: string): boolean {
    this.expire()
    return this.entries.has(kid)
  }

  public record(kid: string): void {
    this.expire()
    this.entries.delete(kid)
    this.entries.set(kid, this.clock.nowMilliseconds() + UNKNOWN_KID_TTL_MILLISECONDS)
    while (this.entries.size > UNKNOWN_KID_CAPACITY) {
      const oldest = this.entries.keys().next().value
      if (typeof oldest === "string") this.entries.delete(oldest)
    }
  }

  public remove(kid: string): void {
    this.entries.delete(kid)
  }

  public size(): number {
    this.expire()
    return this.entries.size
  }

  private expire(): void {
    const now = this.clock.nowMilliseconds()
    for (const [kid, expiresAt] of this.entries) {
      if (expiresAt <= now) this.entries.delete(kid)
    }
  }
}

class RefreshBucket {
  private timestamps: number[] = []

  public constructor(private readonly clock: Clock) {}

  public take(): boolean {
    const now = this.clock.nowMilliseconds()
    this.timestamps = this.timestamps.filter(
      (timestamp) => timestamp > now - REFRESH_WINDOW_MILLISECONDS,
    )
    if (this.timestamps.length >= REFRESH_LIMIT) return false
    this.timestamps.push(now)
    return true
  }
}

export class JwksKeyStore {
  private readonly bucket: RefreshBucket
  private readonly clock: Clock
  private readonly fetcher: JwksFetcher
  private readonly negative: UnknownKidCache
  private readonly keys = new Map<string, CachedKey>()
  private freshUntil = 0
  private graceUntil = 0
  private refreshing: Promise<void> | undefined

  public constructor(options: KeyStoreOptions) {
    this.clock = options.clock
    this.fetcher = options.fetcher
    this.bucket = new RefreshBucket(options.clock)
    this.negative = new UnknownKidCache(options.clock)
  }

  public async resolve(kid: string): Promise<VerificationKey> {
    if (this.negative.has(kid)) {
      throw new AuthenticationError(AuthenticationFailure.UNKNOWN_KID)
    }
    const cached = this.keys.get(kid)
    if (
      cached !== undefined &&
      this.clock.nowMilliseconds() < this.freshUntil &&
      this.clock.nowMilliseconds() < cached.validUntil
    ) {
      return cached.key
    }
    try {
      await this.refresh()
    } catch (error) {
      if (
        cached !== undefined &&
        this.clock.nowMilliseconds() < this.graceUntil &&
        this.clock.nowMilliseconds() < cached.validUntil &&
        error instanceof AuthenticationError
      ) {
        return cached.key
      }
      throw error
    }
    const selected = this.keys.get(kid)
    if (selected !== undefined && this.clock.nowMilliseconds() < selected.validUntil) {
      return selected.key
    }
    this.negative.record(kid)
    throw new AuthenticationError(AuthenticationFailure.UNKNOWN_KID)
  }

  private async refresh(): Promise<void> {
    if (this.refreshing !== undefined) return this.refreshing
    if (!this.bucket.take()) {
      throw new AuthenticationError(AuthenticationFailure.JWKS_RATE_LIMITED)
    }
    const task = this.fetchAndStore()
    this.refreshing = task
    try {
      await task
    } finally {
      if (this.refreshing === task) this.refreshing = undefined
    }
  }

  private async fetchAndStore(): Promise<void> {
    try {
      const parsed = z.array(RsaJwkSchema).min(1).max(64).parse(await this.fetcher.fetch())
      const next = new Map<string, CachedKey>()
      for (const jwk of parsed) {
        if (next.has(jwk.kid) || jwk.notAfterMilliseconds <= this.clock.nowMilliseconds()) {
          throw new Error("JWKS key rejected")
        }
        next.set(jwk.kid, {
          kid: jwk.kid,
          key: await importJWK(toJoseJwk(jwk), "RS256"),
          validUntil: jwk.notAfterMilliseconds,
        })
        this.negative.remove(jwk.kid)
      }
      this.keys.clear()
      for (const [kid, cached] of next) this.keys.set(kid, cached)
      const now = this.clock.nowMilliseconds()
      this.freshUntil = now + JWKS_CACHE_MILLISECONDS
      this.graceUntil = now + JWKS_GRACE_MILLISECONDS
    } catch (error) {
      const options = error instanceof Error ? { cause: error } : undefined
      throw new AuthenticationError(AuthenticationFailure.JWKS_UNAVAILABLE, options)
    }
  }
}

function toJoseJwk(jwk: RsaJwk): JWK {
  return {
    alg: jwk.alg,
    e: jwk.e,
    kid: jwk.kid,
    kty: jwk.kty,
    n: jwk.n,
    use: jwk.use,
  }
}

function validModulus(encoded: string): boolean {
  const bytes = decodeCanonicalBase64Url(encoded)
  if (bytes === undefined || bytes[0] === undefined || bytes[0] === 0) return false
  const bits = (bytes.length - 1) * 8 + (32 - Math.clz32(bytes[0]))
  return bits >= RSA_MODULUS_MINIMUM_BITS && bits <= RSA_MODULUS_MAXIMUM_BITS
}

function validExponent(encoded: string): boolean {
  const bytes = decodeCanonicalBase64Url(encoded)
  if (
    bytes === undefined ||
    bytes.length === 0 ||
    bytes.length > RSA_EXPONENT_MAXIMUM_BYTES ||
    bytes[0] === 0
  ) {
    return false
  }
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  return value >= 3n && value <= 4_294_967_295n && value % 2n === 1n
}

function decodeCanonicalBase64Url(encoded: string): Buffer | undefined {
  const decoded = Buffer.from(encoded, "base64url")
  return decoded.toString("base64url") === encoded ? decoded : undefined
}
