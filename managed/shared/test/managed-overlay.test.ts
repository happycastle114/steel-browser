import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"

import { describe, expect, it } from "vitest"
import { ZodError } from "zod"

import {
  EXPECTED_CORPUS_COMMIT,
  EXPECTED_OVERLAY_PLAN_SHA256,
  EXPECTED_PARENT_PLAN_SHA256,
  FIXTURE_EVALUATION_STATUS,
  OVERLAY_DESCRIPTOR_PATH,
  OVERLAY_ERROR_CODE,
  evaluateOverlayFixture,
  parseManagedOverlayDescriptor,
  parseOverlayFixture,
  verifyManagedOverlayDescriptor,
} from "../src/managed-overlay.js"
import { ManagedOverlayVerificationError } from "../src/managed-overlay.js"

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url))
const DESCRIPTOR_PATH = path.join(REPOSITORY_ROOT, OVERLAY_DESCRIPTOR_PATH)
const FIXTURE_ROOT = path.join(REPOSITORY_ROOT, "managed/tests/fixtures/overlay")

async function readDescriptor() {
  return parseManagedOverlayDescriptor(JSON.parse(await readFile(DESCRIPTOR_PATH, "utf8")))
}

describe("managed Coolify overlay binding", () => {
  it("binds the approved plan, corpus and independent plan matrices", async () => {
    const descriptor = await readDescriptor()
    const todoNine = descriptor.dependencies.find((row) => row.todo === "9")
    const taskTwo = descriptor.supersession.find((row) => row.parentItem === "Task 2")
    const tasksEightToTwentyThree = descriptor.supersession.find((row) => row.parentItem === "Tasks 8-23")

    expect(descriptor.overlay.planSha256).toBe(EXPECTED_OVERLAY_PLAN_SHA256)
    expect(descriptor.overlay.parentPlanSha256).toBe(EXPECTED_PARENT_PLAN_SHA256)
    expect(descriptor.corpus.commit).toBe(EXPECTED_CORPUS_COMMIT)
    expect(descriptor.supersession).toHaveLength(27)
    expect(descriptor.dependencies).toHaveLength(14)
    expect(Object.keys(descriptor.enums)).toHaveLength(22)
    expect(todoNine?.dependsOn).toEqual(["4", "5", "6", "7", "8", "parent-task-40-green"])
    expect(taskTwo?.modeDomain).toBe("DEPENDENCY")
    expect(taskTwo?.secondaryModes).toEqual([{ domain: "HISTORICAL_EVIDENCE", mode: "RETAIN" }])
    expect(tasksEightToTwentyThree?.mode).toBe("RETAIN")
    expect(tasksEightToTwentyThree?.secondaryModes).toEqual([
      { domain: "DEPENDENCY", mode: "AMEND", tasks: ["8", "10", "22"] },
    ])
    verifyManagedOverlayDescriptor(descriptor)
  })

  it.each([
    ["wrong-parent-sha.json", OVERLAY_ERROR_CODE.PARENT_PLAN_SHA_DRIFT],
    ["missing-supersession.json", OVERLAY_ERROR_CODE.SUPERSESSION_COVERAGE],
    ["wrong-corpus.json", OVERLAY_ERROR_CODE.CORPUS_COMMIT_DRIFT],
    ["missing-secondary-pr-author.json", OVERLAY_ERROR_CODE.REVIEW_SECONDARY_AUTHOR],
    ["missing-codeowner-approval.json", OVERLAY_ERROR_CODE.REVIEW_CODEOWNER_APPROVAL],
  ])("rejects descriptor fixture %s for the right reason", async (fixtureName, expectedCode) => {
    const descriptor = await readDescriptor()
    const fixture = parseOverlayFixture(JSON.parse(await readFile(path.join(FIXTURE_ROOT, fixtureName), "utf8")))
    const result = evaluateOverlayFixture(descriptor, fixture)

    expect(result.status).toBe(FIXTURE_EVALUATION_STATUS.REJECTED)
    if (result.status === FIXTURE_EVALUATION_STATUS.REJECTED) expect(result.code).toBe(expectedCode)
  })

  it.each([
    ["dirty-unstaged.json", OVERLAY_ERROR_CODE.DIRTY_WORKTREE],
    ["dirty-index.json", OVERLAY_ERROR_CODE.DIRTY_INDEX],
    ["intermediate-head.json", OVERLAY_ERROR_CODE.INVALID_DIRECT_PARENT],
    ["merge-head.json", OVERLAY_ERROR_CODE.INVALID_PARENT_COUNT],
  ])("rejects lineage fixture %s for the right reason", async (fixtureName, expectedCode) => {
    const descriptor = await readDescriptor()
    const fixture = parseOverlayFixture(JSON.parse(await readFile(path.join(FIXTURE_ROOT, fixtureName), "utf8")))
    const result = evaluateOverlayFixture(descriptor, fixture)

    expect(result.status).toBe(FIXTURE_EVALUATION_STATUS.REJECTED)
    if (result.status === FIXTURE_EVALUATION_STATUS.REJECTED) expect(result.code).toBe(expectedCode)
  })

  it("rejects a descriptor with an absolute/local-user plan path", async () => {
    const descriptor = await readDescriptor()
    expect(() => parseManagedOverlayDescriptor({
      ...descriptor,
      overlay: { ...descriptor.overlay, planFile: "/Users/other/overlay.md" },
    })).toThrowError(ZodError)
  })

  it("requires the exact closed enum member arrays", async () => {
    const descriptor = await readDescriptor()
    const input = { ...descriptor, enums: { ...descriptor.enums, CoolifyOperationState: ["REQUEST_QUEUED", "TERMINAL_SUCCESS"] } }
    let caught: unknown
    try {
      verifyManagedOverlayDescriptor(input)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ManagedOverlayVerificationError)
    if (caught instanceof ManagedOverlayVerificationError) {
      expect(caught.code).toBe(OVERLAY_ERROR_CODE.VERIFICATION_MISMATCH)
    }
  })
})
