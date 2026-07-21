import { X509Certificate } from "node:crypto"
import { TextDecoder } from "node:util"
import { Agent, request } from "undici"
import { z } from "zod"
import type { Clock } from "../clock.js"
import {
  RsaJwkSchema,
  WireRsaJwkSchema,
  type JwksFetcher,
  type RsaJwk,
} from "./jwks-key-store.js"

const JWKS_PATH = "/cdn-cgi/access/certs"
const JWKS_RESPONSE_BYTES = 262_144
const ContentType = { JSON: "application/json" } as const

const CertificateSchema = z
  .object({ cert: z.string().min(1).max(32_768), kid: z.string().min(1).max(256) })
  .strict()
const JwksDocumentSchema = z
  .object({
    keys: z.array(WireRsaJwkSchema).min(1).max(64),
    public_cert: CertificateSchema,
    public_certs: z.array(CertificateSchema).min(1).max(64),
  })
  .strict()

type CloudflareJwksFetcherOptions = Readonly<{
  clock: Clock
  issuer: string
  timeoutMilliseconds: number
}>

export class CloudflareJwksFetcher implements JwksFetcher {
  private readonly dispatcher: Agent
  private readonly endpoint: URL

  public constructor(private readonly options: CloudflareJwksFetcherOptions) {
    this.endpoint = new URL(JWKS_PATH, options.issuer)
    if (this.endpoint.protocol !== "https:") throw new TypeError("JWKS endpoint must use HTTPS")
    this.dispatcher = new Agent({
      bodyTimeout: options.timeoutMilliseconds,
      connectTimeout: options.timeoutMilliseconds,
      connections: 1,
      headersTimeout: options.timeoutMilliseconds,
      maxResponseSize: JWKS_RESPONSE_BYTES,
      pipelining: 1,
    })
  }

  public async fetch(): Promise<readonly RsaJwk[]> {
    const response = await request(this.endpoint, {
      dispatcher: this.dispatcher,
      method: "GET",
      signal: AbortSignal.timeout(this.options.timeoutMilliseconds),
    })
    if (response.statusCode !== 200) {
      await response.body.dump()
      throw new Error("JWKS endpoint rejected")
    }
    const contentType = response.headers["content-type"]
    if (typeof contentType !== "string" || !contentType.startsWith(ContentType.JSON)) {
      await response.body.dump()
      throw new Error("JWKS content type rejected")
    }
    const bytes = await response.body.bytes()
    if (bytes.byteLength > JWKS_RESPONSE_BYTES) throw new Error("JWKS response exceeded bound")
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return parseCloudflareJwks(JSON.parse(decoded), this.options.clock.nowMilliseconds())
  }

  public async close(): Promise<void> {
    await this.dispatcher.close()
  }
}

export function parseCloudflareJwks(input: unknown, nowMilliseconds: number): readonly RsaJwk[] {
  const document = JwksDocumentSchema.parse(input)
  const certificates = new Map<string, X509Certificate>()
  for (const wire of document.public_certs) {
    if (certificates.has(wire.kid)) throw new TypeError("duplicate JWKS certificate")
    certificates.set(wire.kid, new X509Certificate(wire.cert))
  }
  if (!certificates.has(document.public_cert.kid)) {
    throw new TypeError("current JWKS certificate missing")
  }
  return Object.freeze(
    document.keys.map((jwk) => {
      const certificate = certificates.get(jwk.kid)
      if (certificate === undefined) throw new TypeError("JWKS certificate binding missing")
      const validFrom = Date.parse(certificate.validFrom)
      const validUntil = Date.parse(certificate.validTo)
      if (
        !Number.isSafeInteger(validFrom) ||
        !Number.isSafeInteger(validUntil) ||
        validFrom > nowMilliseconds ||
        validUntil <= nowMilliseconds
      ) {
        throw new TypeError("JWKS certificate validity rejected")
      }
      const exported = certificate.publicKey.export({ format: "jwk" })
      if (exported.kty !== jwk.kty || exported.n !== jwk.n || exported.e !== jwk.e) {
        throw new TypeError("JWKS certificate key mismatch")
      }
      return RsaJwkSchema.parse({ ...jwk, notAfterMilliseconds: validUntil })
    }),
  )
}
