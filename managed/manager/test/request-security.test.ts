import { describe, expect, it } from "vitest"
import {
  PRINCIPAL_KIND,
  PRINCIPAL_ROLE,
  PrincipalIdSchema,
} from "@happycastle/steel-managed-shared"
import { AccessJwtAuthenticator } from "../src/auth/jwt-authenticator.js"
import { JwksKeyStore } from "../src/auth/jwks-key-store.js"
import { RequestBoundaryError, RequestBoundaryFailure, RequestSecurity } from "../src/http/request-security.js"
import { MutableClock } from "./test-clock.js"
import { signedJwt, signingFixture } from "./jwt-fixture.js"

describe("public request security", () => {
  it("selects the public origin from the exact allowed Host before authentication", async () => {
    // Given: an unknown Host and an authenticator that records invocations.
    let authenticationCalls = 0
    const security = new RequestSecurity({
      authenticate: async () => {
        authenticationCalls += 1
        return {
          id: PrincipalIdSchema.parse("USER:user@example.com"),
          kind: PRINCIPAL_KIND.USER,
          role: PRINCIPAL_ROLE.USER,
        }
      },
      originByHost: { "steel.example.com": "https://steel.example.com" },
    })

    // When: a request uses an unconfigured Host.
    const authorize = security.authorize({ host: "unknown.example.com" })

    // Then: Host selection fails without touching authentication.
    await expect(authorize).rejects.toMatchObject({ code: RequestBoundaryFailure.HOST_REJECTED })
    expect(authenticationCalls).toBe(0)
  })

  it("returns the USER principal and selected same-origin CORS value", async () => {
    // Given: a valid Access assertion, Host, and matching browser Origin.
    const clock = new MutableClock(1_800_000_000_000)
    const key = signingFixture("request-security")
    const authenticator = new AccessJwtAuthenticator({
      audience: "steel-audience",
      clock,
      issuer: "https://team.cloudflareaccess.com",
      keyStore: new JwksKeyStore({ clock, fetcher: { fetch: async () => [key.jwk] } }),
      maxTokenTtlSeconds: 86_400,
      operatorServicePrincipals: ["operator-service"],
      skewSeconds: 60,
    })
    const security = new RequestSecurity({
      authenticate: (headers) => authenticator.authenticate(headers),
      originByHost: { "steel.example.com": "https://steel.example.com" },
    })
    const token = signedJwt({ kid: key.jwk.kid, privateKey: key.privateKey })

    // When: request security authorizes the boundary.
    const context = await security.authorize({
      "cf-access-jwt-assertion": token,
      host: "steel.example.com",
      origin: "https://steel.example.com",
    })

    // Then: the principal and origin are bound to the selected Host.
    expect(context).toEqual({
      principal: { id: "USER:user@example.com", kind: "USER", role: "USER" },
      publicOrigin: "https://steel.example.com",
    })
  })

  it("rejects a browser Origin that differs from the Host-selected origin", async () => {
    // Given: successful authentication and two independently allowed Host mappings.
    const security = new RequestSecurity({
      authenticate: async () => ({
        id: PrincipalIdSchema.parse("USER:user@example.com"),
        kind: PRINCIPAL_KIND.USER,
        role: PRINCIPAL_ROLE.USER,
      }),
      originByHost: {
        "steel.example.com": "https://steel.example.com",
        "other.example.com": "https://other.example.com",
      },
    })

    // When: one Host supplies the other Host's browser Origin.
    const authorize = security.authorize({
      host: "steel.example.com",
      origin: "https://other.example.com",
    })

    // Then: exact same-origin CORS fails closed.
    await expect(authorize).rejects.toBeInstanceOf(RequestBoundaryError)
    await expect(authorize).rejects.toMatchObject({ code: RequestBoundaryFailure.ORIGIN_REJECTED })
  })
})
