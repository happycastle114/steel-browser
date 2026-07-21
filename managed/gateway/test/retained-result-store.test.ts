import {
  AI_ACTION_REQUEST_SCHEMA,
  CONTROL_PLANE_API_VERSION,
  PrincipalIdSchema,
  ResultIdSchema,
  TOOL_VERSION,
  selectPublicOrigin,
} from "@happycastle/steel-managed-shared"
import { describe, expect, it } from "vitest"

import {
  RETAINED_RESULT_CONTENT,
  InMemoryRetainedResultStore,
  type RetainedResultRecord,
} from "../src/api/managed/retained-result-store.js"

const resultId = ResultIdSchema.parse("018f56c8-6f7a-4c45-9e5d-77adff18f7ac")
const ownerId = PrincipalIdSchema.parse("owner@example.net")
const publicOrigin = selectPublicOrigin("steel.soungmin.tech", {
  "steel.soungmin.tech": "https://steel.soungmin.tech",
})
const action = AI_ACTION_REQUEST_SCHEMA.parse({
  apiVersion: CONTROL_PLANE_API_VERSION,
  tool: { name: "steel.browser.navigate", version: TOOL_VERSION },
  arguments: {
    sessionId: "118f56c8-6f7a-4c45-9e5d-77adff18f7ac",
    url: "https://example.com/",
  },
})

function jsonRecord(): RetainedResultRecord {
  return {
    content: RETAINED_RESULT_CONTENT.JSON,
    resultId,
    action,
    ownerId,
    creatorId: ownerId,
    selectedOrigin: publicOrigin,
    completedAtMs: 2_000,
    expiresAtMs: 62_000,
    output: { kind: "NAVIGATION", nested: { title: "Original" } },
  }
}

describe("in-memory retained AI result store", () => {
  it("clones and deeply freezes JSON records", () => {
    const subject = new InMemoryRetainedResultStore()
    const record = jsonRecord()

    expect(subject.stage(record)).toBe(true)
    expect(subject.get(resultId)).toBeUndefined()
    expect(subject.publish(resultId)).toBe(true)
    const found = subject.get(resultId)

    expect(found).toEqual(record)
    expect(Object.isFrozen(found)).toBe(true)
    expect(found === undefined ? false : Object.isFrozen(found.output)).toBe(true)
  })

  it("copies binary bytes on both write and read", () => {
    const subject = new InMemoryRetainedResultStore()
    const source = new Uint8Array([1, 2, 3])
    const record: RetainedResultRecord = {
      ...jsonRecord(),
      content: RETAINED_RESULT_CONTENT.BINARY,
      bytes: source,
      contentType: "image/png",
    }

    subject.stage(record)
    subject.publish(resultId)
    source[0] = 9
    const first = subject.get(resultId)
    if (first === undefined || first.content !== RETAINED_RESULT_CONTENT.BINARY) {
      throw new TypeError("binary fixture was not retained")
    }
    first.bytes[1] = 9
    const second = subject.get(resultId)
    if (second === undefined || second.content !== RETAINED_RESULT_CONTENT.BINARY) {
      throw new TypeError("binary fixture was not retained")
    }

    expect([...second.bytes]).toEqual([1, 2, 3])
  })

  it("rejects duplicate publication and prunes expired records", () => {
    const subject = new InMemoryRetainedResultStore()

    expect(subject.stage(jsonRecord())).toBe(true)
    expect(subject.stage(jsonRecord())).toBe(false)
    expect(subject.publish(resultId)).toBe(true)
    expect(subject.publish(resultId)).toBe(false)
    expect(subject.prune(61_999)).toEqual([])
    expect(subject.prune(62_000)).toEqual([resultId])
    expect(subject.size()).toBe(0)
  })

  it("returns all retained IDs when cleared", () => {
    const subject = new InMemoryRetainedResultStore()
    subject.stage(jsonRecord())

    expect(subject.clear()).toEqual([resultId])
    expect(subject.clear()).toEqual([])
  })
})
