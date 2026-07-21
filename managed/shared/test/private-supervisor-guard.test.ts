import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { findRawStateComparisons } from "../src/raw-state-comparison.js"
import {
  TYPE_SAFETY_VIOLATION,
  findTypeSafetyViolations,
} from "../src/type-safety-guard.js"

describe("private supervisor contract guard mutations", () => {
  const fixturePath = fileURLToPath(new URL("./semantic-private-supervisor-fixture.ts", import.meta.url))

  it("kills a worker adapter that compares a raw journal state", () => {
    // Given: a supervisor response adapter compares a closed journal state as raw text.
    const mutant = 'declare const state: string; export const pending = state === "UPSTREAM_PENDING"'

    // When: the raw-state guard scans the mutation.
    const violations = findRawStateComparisons(mutant, fixturePath)

    // Then: the canonical journal vocabulary cannot be bypassed.
    expect(violations).toMatchObject([{ member: "UPSTREAM_PENDING" }])
  })

  it("allows the same worker comparison through the canonical contract", () => {
    // Given: the adapter imports its journal state from the shared supervisor contract.
    const source = 'import { CREATE_JOURNAL_STATE } from "../src/private-supervisor-contract.js"; declare const state: string; export const pending = state === CREATE_JOURNAL_STATE.UPSTREAM_PENDING'

    // When: the raw-state guard resolves the canonical export.
    const violations = findRawStateComparisons(source, fixturePath)

    // Then: typed vocabulary access remains the supported path.
    expect(violations).toEqual([])
  })

  it("kills a token lookup adapter that asserts raw text into the branded identifier", () => {
    // Given: an adapter skips the route-parameter schema with a type assertion.
    const mutant = 'import type { PrivateSupervisorCreateLookupParams } from "../src/private-supervisor-contract.js"; declare const token: string; export const params = { token } as PrivateSupervisorCreateLookupParams'

    // When: the type-safety guard scans the mutation.
    const violations = findTypeSafetyViolations(mutant, fixturePath)

    // Then: the unsafe boundary escape is rejected.
    expect(violations).toMatchObject([{ kind: TYPE_SAFETY_VIOLATION.UNSAFE_TYPE_ASSERTION }])
  })

  it("kills an untyped supervisor route registry adapter", () => {
    // Given: an adapter erases the canonical registry member type with explicit any.
    const mutant = "export function route(value: any): any { return value }"

    // When: the type-safety guard scans the mutation.
    const violations = findTypeSafetyViolations(mutant, fixturePath)

    // Then: both input and output escape hatches are rejected.
    expect(violations.map(({ kind }) => kind)).toEqual([
      TYPE_SAFETY_VIOLATION.EXPLICIT_ANY,
      TYPE_SAFETY_VIOLATION.EXPLICIT_ANY,
    ])
  })
})
