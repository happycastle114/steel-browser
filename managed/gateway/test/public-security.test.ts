import { describe, expect, it } from "vitest"
import {
  AccessAuthenticationError,
  PublicHostError,
  PublicOriginError,
  PublicRequestSecurity,
} from "../src/api/public/security.js"

const AUTHORIZATION = "Bearer synthetic-test"

describe("PublicRequestSecurity", () => {
  it("selects only the exact normalized Host origin after Access authentication", async () => {
    // Given
    const security = new PublicRequestSecurity({
      allowedOrigins: ["https://candidate.steel.example"],
      originByHost: {
        "candidate.steel.example": "https://candidate.steel.example",
        "steel.example": "https://steel.example",
      },
      authenticate: async (headers) => {
        if (headers["authorization"] !== AUTHORIZATION) {
          throw new AccessAuthenticationError()
        }
      },
    })

    // When
    const context = await security.authorize({
      headers: {
        authorization: AUTHORIZATION,
        host: "CANDIDATE.STEEL.EXAMPLE:443",
        origin: "https://candidate.steel.example",
        "x-forwarded-host": "steel.example",
      },
    })

    // Then
    expect(context.publicOrigin).toBe("https://candidate.steel.example")
  })

  it("rejects a suffix Host before invoking authentication", async () => {
    // Given
    let authenticationCalls = 0
    const security = new PublicRequestSecurity({
      allowedOrigins: [],
      originByHost: { "steel.example": "https://steel.example" },
      authenticate: async () => {
        authenticationCalls += 1
      },
    })

    // When
    const authorization = security.authorize({
      headers: { host: "steel.example.attacker.invalid" },
    })

    // Then
    await expect(authorization).rejects.toBeInstanceOf(PublicHostError)
    expect(authenticationCalls).toBe(0)
  })

  it("rejects an unapproved browser Origin", async () => {
    // Given
    const security = new PublicRequestSecurity({
      allowedOrigins: ["https://steel.example"],
      originByHost: { "steel.example": "https://steel.example" },
      authenticate: async () => undefined,
    })

    // When
    const authorization = security.authorize({
      headers: { host: "steel.example", origin: "https://attacker.invalid" },
    })

    // Then
    await expect(authorization).rejects.toBeInstanceOf(PublicOriginError)
  })

  it.each([
    "https://user:password@steel.example",
    "https://steel.example/#fragment",
  ])("rejects a configured public origin with credentials or a fragment: %s", (origin) => {
    // Given
    const configuration = () =>
      new PublicRequestSecurity({
        allowedOrigins: [],
        originByHost: { "steel.example": origin },
        authenticate: async () => undefined,
      })

    // When / Then
    expect(configuration).toThrow()
  })
})
