import {
  PRINCIPAL_KIND,
  PRINCIPAL_ROLE,
  PrincipalIdSchema,
  type PrincipalId,
  type PrincipalKind,
  type PrincipalRole,
} from "@happycastle/steel-managed-shared"
import { decodeProtectedHeader, errors, jwtVerify } from "jose"
import { z } from "zod"
import type { Clock } from "../clock.js"
import { AuthenticationError, AuthenticationFailure } from "./authentication-error.js"
import type { JwksKeyStore } from "./jwks-key-store.js"

export { AuthenticationError, AuthenticationFailure } from "./authentication-error.js"

const ACCESS_ASSERTION_HEADER = "cf-access-jwt-assertion"
const MAX_TOKEN_BYTES = 32_768
const ClaimsSchema = z
  .object({
    aud: z.union([z.string().min(1), z.array(z.string().min(1)).min(1).max(16)]),
    common_name: z.string().min(1).max(256).optional(),
    exp: z.number().int().nonnegative().safe(),
    iat: z.number().int().nonnegative().safe(),
    iss: z.string().url(),
    nbf: z.number().int().nonnegative().safe().optional(),
    sub: z.string().max(512),
    type: z.literal("app"),
  })
  .passthrough()
  .readonly()

type AuthenticatorOptions = {
  readonly audience: string
  readonly clock: Clock
  readonly issuer: string
  readonly keyStore: JwksKeyStore
  readonly maxTokenTtlSeconds: number
  readonly operatorServicePrincipals: readonly string[]
  readonly skewSeconds: number
}

export type AuthenticatedPrincipal = {
  readonly id: PrincipalId
  readonly kind: PrincipalKind
  readonly role: PrincipalRole
}

export type AuthenticationHeaders = Readonly<
  Record<string, string | readonly string[] | undefined>
>

export class AccessJwtAuthenticator {
  private readonly operatorServicePrincipals: ReadonlySet<string>

  public constructor(private readonly options: AuthenticatorOptions) {
    this.operatorServicePrincipals = new Set(options.operatorServicePrincipals)
  }

  public async authenticate(headers: AuthenticationHeaders): Promise<AuthenticatedPrincipal> {
    const token = singleHeader(headers, ACCESS_ASSERTION_HEADER)
    if (token === undefined) throw new AuthenticationError(AuthenticationFailure.MISSING_TOKEN)
    if (Buffer.byteLength(token) > MAX_TOKEN_BYTES) {
      throw new AuthenticationError(AuthenticationFailure.MALFORMED_TOKEN)
    }
    let kid: string
    try {
      const header = decodeProtectedHeader(token)
      if (header.alg !== "RS256" || typeof header.kid !== "string" || header.kid.length === 0 || header.kid.length > 256) {
        throw new AuthenticationError(AuthenticationFailure.INVALID_HEADER)
      }
      kid = header.kid
    } catch (error) {
      if (error instanceof AuthenticationError) throw error
      throw authenticationError(AuthenticationFailure.INVALID_HEADER, error)
    }
    const key = await this.options.keyStore.resolve(kid)
    let claims: z.infer<typeof ClaimsSchema>
    try {
      const verified = await jwtVerify(token, key, {
        algorithms: ["RS256"],
        audience: this.options.audience,
        clockTolerance: this.options.skewSeconds,
        currentDate: new Date(this.options.clock.nowMilliseconds()),
        issuer: this.options.issuer,
      })
      claims = ClaimsSchema.parse(verified.payload)
    } catch (error) {
      const failure = error instanceof errors.JWSSignatureVerificationFailed
        ? AuthenticationFailure.INVALID_SIGNATURE
        : AuthenticationFailure.INVALID_CLAIMS
      throw authenticationError(failure, error)
    }
    this.validateClaims(claims)
    return this.principal(claims)
  }

  private validateClaims(claims: z.infer<typeof ClaimsSchema>): void {
    const now = Math.floor(this.options.clock.nowMilliseconds() / 1_000)
    const audience = typeof claims.aud === "string" ? [claims.aud] : claims.aud
    const valid =
      claims.iss === this.options.issuer &&
      audience.includes(this.options.audience) &&
      claims.iat <= now + this.options.skewSeconds &&
      claims.exp > now - this.options.skewSeconds &&
      claims.exp > claims.iat &&
      claims.exp - claims.iat <= this.options.maxTokenTtlSeconds &&
      (claims.nbf === undefined ||
        (claims.nbf <= now + this.options.skewSeconds && claims.nbf <= claims.exp))
    if (!valid) throw new AuthenticationError(AuthenticationFailure.INVALID_CLAIMS)
  }

  private principal(claims: z.infer<typeof ClaimsSchema>): AuthenticatedPrincipal {
    if (claims.common_name !== undefined) {
      if (claims.sub.length !== 0) {
        throw new AuthenticationError(AuthenticationFailure.INVALID_CLAIMS)
      }
      return {
        id: PrincipalIdSchema.parse(`${PRINCIPAL_KIND.SERVICE_TOKEN}:${claims.common_name}`),
        kind: PRINCIPAL_KIND.SERVICE_TOKEN,
        role: this.operatorServicePrincipals.has(claims.common_name)
          ? PRINCIPAL_ROLE.OPERATOR
          : PRINCIPAL_ROLE.USER,
      }
    }
    if (claims.sub.length === 0) {
      throw new AuthenticationError(AuthenticationFailure.INVALID_CLAIMS)
    }
    return {
      id: PrincipalIdSchema.parse(`${PRINCIPAL_KIND.USER}:${claims.sub}`),
      kind: PRINCIPAL_KIND.USER,
      role: PRINCIPAL_ROLE.USER,
    }
  }
}

function authenticationError(failure: AuthenticationFailure, cause: unknown): AuthenticationError {
  return new AuthenticationError(
    failure,
    cause instanceof Error ? { cause } : undefined,
  )
}

function singleHeader(headers: AuthenticationHeaders, selectedName: string): string | undefined {
  const values = Object.entries(headers)
    .filter(([name]) => name.toLowerCase() === selectedName)
    .flatMap(([, value]) => (typeof value === "string" ? [value] : []))
  return values.length === 1 && values[0]?.length !== 0 ? values[0] : undefined
}
