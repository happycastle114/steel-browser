import { z } from "zod"
import { describe, expect, it } from "vitest"

import { withDeepFrozenOutput } from "../src/deep-readonly.js"

function collectContainers(value: unknown): object[] {
  if (value === null || typeof value !== "object") return []
  return [value, ...Object.values(value).flatMap(collectContainers)]
}

describe("deep-frozen schema output", () => {
  it("freezes every parsed object and array", () => {
    // Given: a schema whose output contains nested objects and arrays.
    const schema = withDeepFrozenOutput(z.object({
      nested: z.object({ values: z.array(z.object({ label: z.string() }).strict()) }).strict(),
    }).strict())
    // When: a valid value crosses the schema boundary.
    const parsed = schema.parse({ nested: { values: [{ label: "managed" }] } })
    const containers = collectContainers(parsed)
    // Then: every container is recursively immutable at runtime.
    expect(containers.every(Object.isFrozen)).toBe(true)
    expect(containers.every((container) => Reflect.set(container, "__mutation__", true) === false)).toBe(true)
  })
})
