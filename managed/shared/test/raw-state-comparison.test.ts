import { describe, expect, it } from "vitest"
import { fileURLToPath } from "node:url"

import {
  CLOSED_STATE_MEMBERS,
  findRawStateComparisons,
} from "../src/raw-state-comparison.js"

describe("raw state comparison AST guard", () => {
  const fixturePath = fileURLToPath(new URL("./semantic-raw-fixture.ts", import.meta.url))

  it("detects direct comparisons against every closed member", () => {
    // Given: one source directly compares arbitrary values with every closed string member.
    const comparisons = CLOSED_STATE_MEMBERS.map((member, index) =>
      `export const result${index} = state === ${JSON.stringify(member)}`
    )
    const source = `declare const state: string; ${comparisons.join(";")}`

    // When: the TypeScript AST guard scans it.
    const violations = findRawStateComparisons(source, "member-fixture.ts")

    // Then: every member is reported exactly once.
    expect(violations.map((violation) => violation.member).sort()).toEqual(CLOSED_STATE_MEMBERS)
  })

  it("allows comparisons through the canonical enum object", () => {
    // Given: a comparison whose right side is a typed member access.
    const source = 'import { MANAGED_PROJECT_RUNTIME_STATE } from "../src/deployment-vocabulary.js"; declare const state: string; export const result = state === MANAGED_PROJECT_RUNTIME_STATE.ACTIVE'

    // When: the TypeScript AST guard scans it.
    const violations = findRawStateComparisons(source, fixturePath)

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

  it("detects a raw closed member hidden behind a local alias", () => {
    // Given: a raw lifecycle member assigned to a generic constant before comparison.
    const source = 'const terminal = "RELEASED"; declare const state: string; export const result = state === terminal'
    // When: the semantic raw-state guard scans it.
    const violations = findRawStateComparisons(source, "alias-fixture.ts")
    // Then: the alias remains a raw RELEASED comparison.
    expect(violations).toMatchObject([{ member: "RELEASED" }])
  })

  it("detects a raw closed member hidden in an object property", () => {
    // Given: a local object stores a lifecycle literal before a comparison.
    const source = 'const box = { terminal: "LIVE" }; declare const state: string; export const result = state === box.terminal'
    // When: the semantic raw-state guard resolves the property symbol.
    const violations = findRawStateComparisons(source, "property-fixture.ts")
    // Then: property indirection cannot hide the raw lifecycle member.
    expect(violations).toMatchObject([{ member: "LIVE" }])
  })

  it("detects membership checks backed by raw closed members", () => {
    // Given: direct and aliased arrays contain lifecycle literals used by includes.
    const source = 'const terminalStates = ["LIVE"]; declare const state: string; export const result = ["LIVE"].includes(state) || terminalStates.includes(state)'
    // When: the semantic raw-state guard resolves the array symbol.
    const violations = findRawStateComparisons(source, "membership-fixture.ts")
    // Then: membership indirection cannot hide the raw lifecycle member.
    expect(violations).toMatchObject([
      { member: "LIVE", operator: "includes" },
      { member: "LIVE", operator: "includes" },
    ])
  })

  it("detects raw membership through an array spread", () => {
    // Given: a raw lifecycle member is spread into the collection used by includes.
    const source = 'const closed = ["LIVE"]; declare const state: string; export const result = [...closed].includes(state)'
    // When: the semantic raw-state guard follows the spread source.
    const violations = findRawStateComparisons(source, "spread-membership-fixture.ts")
    // Then: collection reconstruction cannot hide the raw member.
    expect(violations).toMatchObject([{ member: "LIVE", operator: "includes" }])
  })

  it("detects raw closed members through computed property access", () => {
    // Given: a computed object property and element access carry a lifecycle literal.
    const source = 'const box = { ["terminal"]: "LIVE" }; declare const state: string; export const result = state === box["terminal"]'
    // When: the semantic raw-state guard resolves the element access.
    const violations = findRawStateComparisons(source, "computed-property-fixture.ts")
    // Then: computed syntax cannot hide the raw member.
    expect(violations).toMatchObject([{ member: "LIVE" }])
  })

  it("detects a raw closed member returned by a helper", () => {
    // Given: a local helper returns a lifecycle literal into a comparison.
    const source = 'function live() { return "LIVE" } declare const state: string; export const result = state === live()'
    // When: the semantic raw-state guard follows the helper return.
    const violations = findRawStateComparisons(source, "helper-return-fixture.ts")
    // Then: function indirection cannot hide the raw member.
    expect(violations).toMatchObject([{ member: "LIVE" }])
  })

  it("detects a raw closed member assembled by a constant expression", () => {
    // Given: a lifecycle literal is assembled from constant string operands.
    const source = 'const live = "LI" + "VE"; declare const state: string; export const result = state === live'
    // When: the semantic raw-state guard evaluates the constant expression.
    const violations = findRawStateComparisons(source, "constant-expression-fixture.ts")
    // Then: constant folding cannot hide the raw member.
    expect(violations).toMatchObject([{ member: "LIVE" }])
  })

  it("allows membership checks through the canonical enum object", () => {
    // Given: a membership collection is built from canonical enum members.
    const source = 'import { SESSION_STATE } from "../src/control-plane-vocabulary.js"; declare const state: string; export const result = [SESSION_STATE.LIVE].includes(state)'
    // When: the semantic raw-state guard scans it.
    const violations = findRawStateComparisons(source, fixturePath)
    // Then: canonical vocabulary remains the allowed comparison source.
    expect(violations).toEqual([])
  })

  it("rejects an exported const object outside trusted vocabulary modules", () => {
    // Given: an arbitrary module tries to mimic a canonical vocabulary export.
    const source = 'export const BOX = { terminal: "LIVE" } as const; declare const state: string; export const result = state === BOX.terminal'
    // When: the semantic guard resolves the exported property symbol.
    const violations = findRawStateComparisons(source, "untrusted-export-fixture.ts")
    // Then: export shape alone does not grant vocabulary trust.
    expect(violations).toMatchObject([{ member: "LIVE" }])
  })

  it("rejects a local object even when its file path is a trusted vocabulary module", () => {
    // Given: an ordinary local object is injected under the exact retry vocabulary path.
    const source = 'const box = { terminal: "LIVE" } as const; declare const state: string; export const result = state === box.terminal'
    const retryAfterPath = fileURLToPath(new URL("../src/retry-after.ts", import.meta.url))
    // When: the semantic guard checks declaration identity rather than trusting the file wholesale.
    const violations = findRawStateComparisons(source, retryAfterPath)
    // Then: the local declaration is still rejected.
    expect(violations).toMatchObject([{ member: "LIVE" }])
  })

  it("detects raw closed members in switch cases", () => {
    // Given: a lifecycle switch that bypasses the canonical vocabulary object.
    const source = 'declare const state: string; switch (state) { case "LIVE": break; default: break }'
    // When: the semantic raw-state guard scans it.
    const violations = findRawStateComparisons(source, "switch-fixture.ts")
    // Then: the raw LIVE case is rejected.
    expect(violations).toMatchObject([{ member: "LIVE", operator: "case" }])
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
