import { describe, expect, it } from "vitest"

import {
  EMPTY_EVENT_SEQUENCE,
  LIST_RESOURCE_KIND,
  decodeEventCursor,
  decodeListCursor,
  encodeEventCursor,
  encodeListCursor,
} from "../src/cursor-contract.js"
import {
  BootIdSchema,
  CanonicalCursorSequenceSchema,
  SafeCountSchema,
  Sha256Schema,
  SnapshotIdSchema,
} from "../src/control-plane-primitives.js"

const bootId = BootIdSchema.parse("018f56c8-6f7a-4c45-9e5d-77adff18f7ac")

describe("canonical managed cursors", () => {
  it("round-trips the empty-to-first event predecessor without a JSON number", () => {
    // Given: the cursor-only zero predecessor for one boot.
    const payload = { v: 1, b: bootId, s: EMPTY_EVENT_SEQUENCE } as const
    // When: it is encoded and decoded through RFC 8785 base64url.
    const decoded = decodeEventCursor(encodeEventCursor(payload))
    // Then: the sequence remains the canonical decimal string zero.
    expect(decoded).toEqual(payload)
    expect(typeof decoded.s).toBe("string")
  })

  it("round-trips an exact list snapshot cursor", () => {
    // Given: one server-issued offset in a random UUIDv4 snapshot.
    const payload = {
      v: 1,
      b: bootId,
      k: LIST_RESOURCE_KIND.SESSIONS,
      f: Sha256Schema.parse("a".repeat(64)),
      n: SnapshotIdSchema.parse("118f56c8-6f7a-4c45-9e5d-77adff18f7ac"),
      o: SafeCountSchema.parse(50),
    } as const
    // When: the payload crosses both cursor directions.
    // Then: every typed field is recovered byte-for-byte.
    expect(decodeListCursor(encodeListCursor(payload))).toEqual(payload)
  })

  it("rejects noncanonical and unsafe event cursor payloads", () => {
    // Given: base64url cursors containing leading-zero and uint64-overflow sequences.
    const encodeRaw = (sequence: string): string => Buffer.from(
      JSON.stringify({ v: 1, b: bootId, s: sequence }),
      "utf8",
    ).toString("base64url")
    // When: each untrusted cursor is decoded.
    const decode = ["01", "18446744073709551616"].map((sequence) => () => decodeEventCursor(encodeRaw(sequence)))
    // Then: neither unsafe form crosses the boundary.
    for (const attempt of decode) expect(attempt).toThrow()
    expect(CanonicalCursorSequenceSchema.safeParse("0").success).toBe(true)
  })
})
