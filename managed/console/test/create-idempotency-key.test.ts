import { afterEach, describe, expect, it } from "vitest"

import {
  clearPendingCreateKey,
  loadPendingCreateKey,
  savePendingCreateKey,
} from "../src/api/create-idempotency-key.js"
import { CreateIdempotencyKeySchema } from "../src/api/schema-primitives.js"

describe("pending create idempotency key", () => {
  afterEach(() => clearPendingCreateKey())

  it("survives a tab reload boundary until the outcome is definitive", () => {
    const key = CreateIdempotencyKeySchema.parse("console:550e8400-e29b-41d4-a716-446655440000")

    savePendingCreateKey(key)
    expect(loadPendingCreateKey()).toBe(key)

    clearPendingCreateKey()
    expect(loadPendingCreateKey()).toBeUndefined()
  })

  it("fails closed and removes a tampered stored value", () => {
    globalThis.sessionStorage.setItem("steel.managed.pending-create-key.v1", "invalid/key")

    expect(loadPendingCreateKey()).toBeUndefined()
    expect(globalThis.sessionStorage.length).toBe(0)
  })
})
