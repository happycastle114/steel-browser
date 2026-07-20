import { readFile } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  EXPECTED_CORPUS_COMMIT,
  EXPECTED_DEPENDENCIES,
  EXPECTED_OVERLAY_PLAN_SHA256,
  EXPECTED_PARENT_PLAN_SHA256,
  EXPECTED_SUPERSESSION,
  OVERLAY_DESCRIPTOR_PATH,
  OVERLAY_ENUMS,
  applyOverlayFixture,
  parseManagedOverlayDescriptor,
  parseOverlayFixture,
  verifyManagedOverlayDescriptor,
} from "../src/managed-overlay.js"

const REPOSITORY_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..")
const DESCRIPTOR_PATH = path.join(REPOSITORY_ROOT, OVERLAY_DESCRIPTOR_PATH)
const FIXTURE_ROOT = path.join(REPOSITORY_ROOT, "managed/tests/fixtures/overlay")

async function readDescriptor() {
  const text = await readFile(DESCRIPTOR_PATH, "utf8")
  return parseManagedOverlayDescriptor(JSON.parse(text) as unknown)
}

describe("managed Coolify overlay binding", () => {
  it("binds the approved plan, corpus and complete policy vocabulary", async () => {
    const descriptor = await readDescriptor()

    expect(descriptor.overlay.planSha256).toBe(EXPECTED_OVERLAY_PLAN_SHA256)
    expect(descriptor.overlay.parentPlanSha256).toBe(EXPECTED_PARENT_PLAN_SHA256)
    expect(descriptor.corpus.commit).toBe(EXPECTED_CORPUS_COMMIT)
    expect(descriptor.supersession).toHaveLength(EXPECTED_SUPERSESSION.length)
    expect(descriptor.dependencies).toHaveLength(EXPECTED_DEPENDENCIES.length)
    expect(Object.keys(descriptor.enums)).toHaveLength(Object.keys(OVERLAY_ENUMS).length)

    expect(() => verifyManagedOverlayDescriptor(descriptor)).not.toThrow()
  })

  it.each([
    "wrong-parent-sha.json",
    "missing-supersession.json",
    "wrong-corpus.json",
    "missing-secondary-pr-author.json",
    "missing-codeowner-approval.json",
  ])("rejects the overlay negative fixture %s", async (fixtureName) => {
    const descriptor = await readDescriptor()
    const fixtureText = await readFile(path.join(FIXTURE_ROOT, fixtureName), "utf8")
    const fixture = parseOverlayFixture(JSON.parse(fixtureText) as unknown)
    const mutated = applyOverlayFixture(descriptor, fixture)

    expect(() => verifyManagedOverlayDescriptor(mutated)).toThrow()
  })

  it("rejects a descriptor with an absolute/local-user plan path", async () => {
    const descriptor = await readDescriptor()
    const input = {
      ...descriptor,
      overlay: { ...descriptor.overlay, planFile: "/Users/other/overlay.md" },
    }

    expect(() => parseManagedOverlayDescriptor(input)).toThrow()
  })

  it("requires the exact closed enum member arrays", async () => {
    const descriptor = await readDescriptor()
    const input = {
      ...descriptor,
      enums: { ...descriptor.enums, CoolifyOperationState: ["REQUEST_QUEUED", "TERMINAL_SUCCESS"] },
    }

    expect(() => verifyManagedOverlayDescriptor(input)).toThrow("enum vocabulary drift")
  })
})
