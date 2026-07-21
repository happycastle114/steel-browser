import { ResultIdSchema } from "@happycastle/steel-managed-shared"
import { describe, expect, it } from "vitest"

import { RandomResultIdFactory } from "../src/api/managed/result-id-factory.js"

describe("managed AI result ID factory", () => {
  it("creates a fresh canonical version-four result ID", () => {
    const subject = new RandomResultIdFactory()

    const first = subject.next()
    const second = subject.next()

    expect(ResultIdSchema.safeParse(first).success).toBe(true)
    expect(first).not.toBe(second)
  })
})
