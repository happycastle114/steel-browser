import { describe, expect, it } from "vitest"
import { fileURLToPath } from "node:url"

import { TYPE_SAFETY_VIOLATION, findTypeSafetyViolations } from "../src/type-safety-guard.js"

describe("managed shared type-safety AST guard", () => {
  const fixturePath = fileURLToPath(new URL("./semantic-type-fixture.ts", import.meta.url))
  const sequencePrelude = 'import type { CanonicalCursorSequence, EventSequence } from "../src/control-plane-primitives.js"; '

  it("rejects explicit any annotations", () => {
    // Given: a boundary that erases its input type.
    const source = "export function parse(value: any): any { return value }"
    // When: the type-safety guard scans it.
    const violations = findTypeSafetyViolations(source, "unsafe.ts")
    // Then: both explicit escape hatches are reported.
    expect(violations.map((violation) => violation.kind)).toEqual([
      TYPE_SAFETY_VIOLATION.EXPLICIT_ANY,
      TYPE_SAFETY_VIOLATION.EXPLICIT_ANY,
    ])
  })

  it("rejects JSON-number conversion of event sequence strings", () => {
    // Given: a conversion that can lose uint64 precision.
    const source = `${sequencePrelude}declare const value: EventSequence; export const parsed = Number(value)`
    // When: the type-safety guard scans it.
    const violations = findTypeSafetyViolations(source, fixturePath)
    // Then: the unsafe conversion is reported.
    expect(violations).toMatchObject([{ kind: TYPE_SAFETY_VIOLATION.UNSAFE_SEQUENCE_NUMBER }])
  })

  it("allows exact bigint conversion after boundary parsing", () => {
    // Given: an exact decimal-to-bigint conversion.
    const source = "export const parsed = BigInt(eventSequence)"
    // When: the type-safety guard scans it.
    const violations = findTypeSafetyViolations(source, "safe-sequence.ts")
    // Then: no escape hatch is reported.
    expect(violations).toEqual([])
  })

  it.each([
    "parseInt(value, 10)",
    "parseFloat(value)",
    "+value",
  ])("rejects another lossy uint64 conversion: %s", (source) => {
    // Given: a non-Number conversion that still narrows uint64 text to JSON number.
    // When: the type-safety guard scans it.
    const violations = findTypeSafetyViolations(
      `${sequencePrelude}declare const value: CanonicalCursorSequence; export const parsed = ${source}`,
      fixturePath,
    )
    // Then: the conversion is rejected by the same guard.
    expect(violations).toMatchObject([{ kind: TYPE_SAFETY_VIOLATION.UNSAFE_SEQUENCE_NUMBER }])
  })

  it("tracks a sequence value through an alias into Number", () => {
    // Given: a uint64 sequence string renamed to a generic local identifier.
    const source = `${sequencePrelude}declare const original: EventSequence; const value = original; export const parsed = Number(value)`
    // When: the semantic type-safety guard scans it.
    const violations = findTypeSafetyViolations(source, fixturePath)
    // Then: the alias cannot hide lossy JSON-number conversion.
    expect(violations).toMatchObject([{ kind: TYPE_SAFETY_VIOLATION.UNSAFE_SEQUENCE_NUMBER }])
  })

  it("tracks sequence provenance through explicit string widening", () => {
    // Given: a branded sequence is deliberately widened before numeric conversion.
    const source = `${sequencePrelude}declare const original: EventSequence; const value: string = original; export const parsed = Number(value)`
    // When: the semantic guard traces the widened declaration initializer.
    const violations = findTypeSafetyViolations(source, fixturePath)
    // Then: widening cannot erase the lossy-conversion finding.
    expect(violations).toMatchObject([{ kind: TYPE_SAFETY_VIOLATION.UNSAFE_SEQUENCE_NUMBER }])
  })

  it.each(["Number.parseInt(value, 10)", "Number.parseFloat(value)"])(
    "rejects a Number namespace sequence conversion: %s",
    (conversion) => {
      // Given: a branded sequence is passed to a standard Number namespace parser.
      const source = `${sequencePrelude}declare const value: EventSequence; export const parsed = ${conversion}`
      // When: the semantic guard resolves the global Number namespace symbol.
      const violations = findTypeSafetyViolations(source, fixturePath)
      // Then: namespace syntax cannot bypass the conversion policy.
      expect(violations).toMatchObject([{ kind: TYPE_SAFETY_VIOLATION.UNSAFE_SEQUENCE_NUMBER }])
    },
  )

  it("tracks sequence provenance through a generic pass-through helper", () => {
    // Given: a generic helper returns the same sequence value under an inferred type.
    const source = `${sequencePrelude}function pass<T extends string>(value: T): string { return value } declare const sequence: EventSequence; export const parsed = Number(pass(sequence))`
    // When: the semantic guard follows the resolved signature and return expression.
    const violations = findTypeSafetyViolations(source, fixturePath)
    // Then: the helper call cannot erase sequence provenance.
    expect(violations).toMatchObject([{ kind: TYPE_SAFETY_VIOLATION.UNSAFE_SEQUENCE_NUMBER }])
  })

  it("tracks a generic helper that widens through the global String conversion", () => {
    // Given: a generic helper explicitly erases the brand through standard string conversion.
    const source = `${sequencePrelude}function pass<T extends string>(value: T): string { return String(value) } declare const sequence: EventSequence; export const parsed = Number(pass(sequence))`
    // When: the semantic guard follows the resolved helper and standard conversion.
    const violations = findTypeSafetyViolations(source, fixturePath)
    // Then: the explicit string conversion cannot erase sequence provenance.
    expect(violations).toMatchObject([{ kind: TYPE_SAFETY_VIOLATION.UNSAFE_SEQUENCE_NUMBER }])
  })

  it("propagates sequence provenance into a helper parameter", () => {
    // Given: a helper accepts a widened string and performs the lossy conversion internally.
    const source = `${sequencePrelude}function parse(value: string): number { return Number(value) } declare const sequence: EventSequence; export const parsed = parse(sequence)`
    // When: the semantic guard connects the call argument to the resolved parameter symbol.
    const violations = findTypeSafetyViolations(source, fixturePath)
    // Then: moving the conversion into the helper cannot bypass the policy.
    expect(violations).toMatchObject([{ kind: TYPE_SAFETY_VIOLATION.UNSAFE_SEQUENCE_NUMBER }])
  })

  it("rejects unsafe type assertions", () => {
    // Given: an unknown value asserted directly into a domain contract.
    const source = "declare const candidate: unknown; export const value = candidate as Contract"
    // When: the type-safety guard scans it.
    const violations = findTypeSafetyViolations(source, "unsafe-assertion.ts")
    // Then: the assertion escape hatch is reported.
    expect(violations).toMatchObject([{ kind: TYPE_SAFETY_VIOLATION.UNSAFE_TYPE_ASSERTION }])
  })

  it("rejects non-null assertions", () => {
    // Given: a boundary suppresses nullable evidence with a postfix assertion.
    const source = "declare const value: string | undefined; export const unsafe = value!"
    // When: the type-safety guard scans it.
    const violations = findTypeSafetyViolations(source, fixturePath)
    // Then: the non-null escape hatch is reported.
    expect(violations).toMatchObject([{ kind: TYPE_SAFETY_VIOLATION.NON_NULL_ASSERTION }])
  })

  it.each(["@ts-ignore", "@ts-expect-error", "@ts-nocheck"])("rejects the %s directive", (directive) => {
    // Given: a compiler diagnostic is suppressed with a TypeScript directive.
    const source = `// ${directive}\nexport const value: string = 1`
    // When: the type-safety guard scans it.
    const violations = findTypeSafetyViolations(source, fixturePath)
    // Then: the diagnostic suppression is reported.
    expect(violations).toMatchObject([{ kind: TYPE_SAFETY_VIOLATION.TS_DIRECTIVE }])
  })

  it("allows unrelated names that merely contain sequence or cursor", () => {
    // Given: ordinary numeric strings use names that resemble domain sequences.
    const source = "declare const sequenceLabel: string; const cursorCount = '7'; export const values = [Number(sequenceLabel), parseInt(cursorCount, 10)]"
    // When: the semantic type-safety guard checks their actual types.
    const violations = findTypeSafetyViolations(source, fixturePath)
    // Then: names alone do not create false positives.
    expect(violations).toEqual([])
  })
})
