import { PRINCIPAL_KIND, PRINCIPAL_ROLE } from "@happycastle/steel-managed-shared"
import { describe, expect, it } from "vitest"
import {
  AccessJwtAuthenticator,
  AuthenticationError,
  AuthenticationFailure,
} from "../src/auth/jwt-authenticator.js"
import { JwksKeyStore } from "../src/auth/jwks-key-store.js"
import { MutableClock } from "./test-clock.js"
import { signedJwt, signingFixture } from "./jwt-fixture.js"

describe("Cloudflare Access JWT authenticator", () => {
  it("maps an authenticated subject to USER", async () => {
    // Given: a valid RS256 token from the configured Access issuer and audience.
    const clock = new MutableClock(1_800_000_000_000)
    const key = signingFixture("key-user")
    const authenticator = authenticatorWith(clock, key.jwk)
    const token = signedJwt({ kid: key.jwk.kid, privateKey: key.privateKey })

    // When: the Access assertion header is authenticated.
    const principal = await authenticator.authenticate({ "cf-access-jwt-assertion": token })

    // Then: the unlisted subject is a USER principal.
    expect(principal).toEqual({
      id: "USER:user@example.com",
      kind: PRINCIPAL_KIND.USER,
      role: PRINCIPAL_ROLE.USER,
    })
  })

  it("maps only configured service subjects to OPERATOR", async () => {
    // Given: a valid Access token whose subject is in the operator allowlist.
    const clock = new MutableClock(1_800_000_000_000)
    const key = signingFixture("key-operator")
    const authenticator = authenticatorWith(clock, key.jwk)
    const token = signedJwt({
      kid: key.jwk.kid,
      privateKey: key.privateKey,
      claims: { common_name: "operator-service", sub: "" },
    })

    // When: the token is authenticated.
    const principal = await authenticator.authenticate({ "cf-access-jwt-assertion": token })

    // Then: the exact configured subject receives OPERATOR.
    expect(principal).toEqual({
      id: "SERVICE_TOKEN:operator-service",
      kind: PRINCIPAL_KIND.SERVICE_TOKEN,
      role: PRINCIPAL_ROLE.OPERATOR,
    })
  })

  it("maps only configured Access user emails to OPERATOR", async () => {
    // Given: a valid Access user token with an allowlisted email and stable subject.
    const clock = new MutableClock(1_800_000_000_000)
    const key = signingFixture("key-human-operator")
    const authenticator = authenticatorWith(clock, key.jwk)
    const token = signedJwt({
      kid: key.jwk.kid,
      privateKey: key.privateKey,
      claims: { email: "Operator@Example.com", sub: "access-user-id" },
    })

    // When: the Access assertion is authenticated.
    const principal = await authenticator.authenticate({ "cf-access-jwt-assertion": token })

    // Then: the normalized allowlisted email receives OPERATOR without changing identity.
    expect(principal).toEqual({
      id: "USER:access-user-id",
      kind: PRINCIPAL_KIND.USER,
      role: PRINCIPAL_ROLE.OPERATOR,
    })
  })

  it("accepts an assertion for an additional configured Access application", async () => {
    // Given: Managed OAuth uses a dedicated Access application audience.
    const clock = new MutableClock(1_800_000_000_000)
    const key = signingFixture("key-additional-audience")
    const authenticator = authenticatorWith(clock, key.jwk)
    const token = signedJwt({
      kid: key.jwk.kid,
      privateKey: key.privateKey,
      claims: { aud: ["steel-mcp-audience"] },
    })

    // When: the Access assertion is authenticated.
    const principal = await authenticator.authenticate({ "cf-access-jwt-assertion": token })

    // Then: the dedicated application has the same authenticated user boundary.
    expect(principal.role).toBe(PRINCIPAL_ROLE.USER)
  })

  it.each([
    ["issuer", { iss: "https://other.cloudflareaccess.com" }],
    ["audience", { aud: ["other-audience"] }],
    ["issued-at future", { iat: 1_800_000_061 }],
    ["expired", { exp: 1_799_999_939 }],
    ["not-before future", { nbf: 1_800_000_061 }],
    ["TTL", { iat: 1_799_900_000, exp: 1_800_000_100 }],
  ])("rejects an invalid %s claim", async (_caseName, claims) => {
    // Given: a correctly signed token with one invalid bounded claim.
    const clock = new MutableClock(1_800_000_000_000)
    const key = signingFixture("key-invalid")
    const authenticator = authenticatorWith(clock, key.jwk)
    const token = signedJwt({ kid: key.jwk.kid, privateKey: key.privateKey, claims })

    // When: the claim set is authenticated.
    const authenticate = authenticator.authenticate({ "cf-access-jwt-assertion": token })

    // Then: claims fail closed with a typed authentication result.
    await expect(authenticate).rejects.toMatchObject({
      code: AuthenticationFailure.INVALID_CLAIMS,
    })
  })

  it("rejects an assertion whose signature does not match its kid", async () => {
    // Given: the header selects one key while another key signs the token.
    const clock = new MutableClock(1_800_000_000_000)
    const trusted = signingFixture("trusted")
    const attacker = signingFixture("attacker")
    const authenticator = authenticatorWith(clock, trusted.jwk)
    const token = signedJwt({ kid: trusted.jwk.kid, privateKey: attacker.privateKey })

    // When: signature verification runs.
    const authenticate = authenticator.authenticate({ "cf-access-jwt-assertion": token })

    // Then: it fails without exposing key or claim details.
    await expect(authenticate).rejects.toBeInstanceOf(AuthenticationError)
    await expect(authenticate).rejects.toMatchObject({
      code: AuthenticationFailure.INVALID_SIGNATURE,
    })
  })
})

function authenticatorWith(clock: MutableClock, jwk: ReturnType<typeof signingFixture>["jwk"]): AccessJwtAuthenticator {
  const keyStore = new JwksKeyStore({
    clock,
    fetcher: { fetch: async () => [jwk] },
  })
  return new AccessJwtAuthenticator({
    audiences: ["steel-audience", "steel-mcp-audience"],
    clock,
    issuer: "https://team.cloudflareaccess.com",
    keyStore,
    maxTokenTtlSeconds: 86_400,
    operatorServicePrincipals: ["operator-service"],
    operatorUserEmails: ["operator@example.com"],
    skewSeconds: 60,
  })
}
