import {
  CreateIdempotencyKeySchema,
  ManagerInstanceIdSchema,
  PoolIdSchema,
  PrincipalIdSchema,
  SessionIdSchema,
} from "@happycastle/steel-managed-shared"
import { describe, expect, it } from "vitest"
import { ManagedCreateHeaders } from "../src/operations/managed-create-headers.js"
import { CreateTokenKeyMaterial } from "../src/secret/create-token-key.js"

describe("managed create headers", () => {
  it("derives stable keyed correlation and unique compatibility tokens", async () => {
    const headers = new ManagedCreateHeaders({
      key: new CreateTokenKeyMaterial(Buffer.alloc(32, 7)),
      managerInstanceId: ManagerInstanceIdSchema.parse("00000000-0000-4000-8000-000000000301"),
      poolId: PoolIdSchema.parse("test-pool"),
    })
    const input = {
      idempotencyKey: CreateIdempotencyKeySchema.parse("request-key-001"),
      principalId: PrincipalIdSchema.parse("USER:fixture"),
      sessionId: SessionIdSchema.parse("00000000-0000-4000-8000-000000000101"),
    }

    const first = await headers.keyed(input)
    const replay = await headers.keyed(input)
    const compatibility = await headers.compatibility(input.principalId, input.sessionId)

    expect(replay).toEqual(first)
    expect(first["x-managed-create-token"]).toMatch(/^h1_[0-9a-f]{64}$/u)
    expect(compatibility["x-managed-create-token"]).toMatch(/^r1_[0-9a-f-]{36}$/u)
  })
})
