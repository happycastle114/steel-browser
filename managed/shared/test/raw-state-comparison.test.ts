import { describe, expect, it } from "vitest"

import {
  CLOSED_STATE_MEMBERS,
  findRawStateComparisons,
} from "../src/raw-state-comparison.js"

describe("raw state comparison AST guard", () => {
  it.each(CLOSED_STATE_MEMBERS)("detects direct comparison against closed member %s", (member) => {
    // Given: source that directly compares an arbitrary value with one closed string member.
    const source = `declare const state: string; export const result = state === ${JSON.stringify(member)}`

    // When: the TypeScript AST guard scans it.
    const violations = findRawStateComparisons(source, "member-fixture.ts")

    // Then: that member is reported exactly once.
    expect(violations).toHaveLength(1)
    expect(violations[0]?.member).toBe(member)
  })

  it("allows comparisons through the canonical enum object", () => {
    // Given: a comparison whose right side is a typed member access.
    const source = "declare const state: string; export const result = state === MANAGED_PROJECT_RUNTIME_STATE.ACTIVE"

    // When: the TypeScript AST guard scans it.
    const violations = findRawStateComparisons(source, "typed-fixture.ts")

    // Then: no raw literal violation exists.
    expect(violations).toEqual([])
  })

  it("detects a parenthesized const literal comparison", () => {
    // Given: a closed literal wrapped in syntax that must not evade direct-comparison policy.
    const source = "declare const state: string; export const result = state === (\"ACTIVE\" as const)"

    // When: the TypeScript AST guard scans it.
    const violations = findRawStateComparisons(source, "wrapped-fixture.ts")

    // Then: the wrapped literal remains a violation.
    expect(violations).toHaveLength(1)
  })

  it("ignores closed strings that are data rather than comparisons", () => {
    // Given: a state member used as ordinary fixture data.
    const source = "export const fixture = { state: \"ACTIVE\" }"

    // When: the TypeScript AST guard scans it.
    const violations = findRawStateComparisons(source, "data-fixture.ts")

    // Then: data construction is not confused with a comparison.
    expect(violations).toEqual([])
  })
})
