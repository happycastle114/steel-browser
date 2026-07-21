import { describe, expect, it } from "vitest"

import { deriveCreateCorrelation, parseCreateTokenKey, type CreateCorrelationInput } from "../src/create-correlation.js"
import { CreateIdempotencyKeySchema, PrincipalIdSchema } from "../src/control-plane-primitives.js"
import { CONTROL_PLANE_SESSION_ID_MODE, PRINCIPAL_KIND } from "../src/control-plane-vocabulary.js"

describe("canonical create correlation boundary", () => {
  it("accepts canonical branded principal and idempotency primitives", async () => {
    // Given: raw ingress values parsed once by their canonical boundary schemas.
    const input: CreateCorrelationInput = {
      key: parseCreateTokenKey("ab".repeat(32)),
      principalKind: PRINCIPAL_KIND.USER,
      principalId: PrincipalIdSchema.parse("operator@example.com"),
      idempotencyKey: CreateIdempotencyKeySchema.parse("request:12345678"),
      requestBody: { browser: "chromium" },
      sessionIdMode: CONTROL_PLANE_SESSION_ID_MODE.CLIENT_SUPPLIED,
    }
    // When: trusted typed values enter deterministic correlation logic.
    const correlation = await deriveCreateCorrelation(input)
    // Then: the logic derives a keyed token without reparsing weaker strings.
    expect(correlation.createToken).toMatch(/^h1_[0-9a-f]{64}$/u)
  })

  it("keeps invalid raw values outside the branded logic boundary", () => {
    // Given: an overlong principal and a short idempotency key.
    const principal = PrincipalIdSchema.safeParse("p".repeat(513))
    const idempotencyKey = CreateIdempotencyKeySchema.safeParse("short")
    // When: canonical public schemas validate both raw values.
    // Then: neither can acquire the brand required by correlation logic.
    expect(principal.success).toBe(false)
    expect(idempotencyKey.success).toBe(false)
  })
})
