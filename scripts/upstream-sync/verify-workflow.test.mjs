import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

import { verifyWorkflowText } from "./verify-workflow.mjs"

const workflowPath = path.resolve(".github/workflows/upstream-sync.yml")

test("upstream sync workflow satisfies the reviewed contract", async () => {
  const workflow = await readFile(workflowPath, "utf8")
  assert.deepEqual(verifyWorkflowText(workflow), { status: "VERIFIED" })
})

test("workflow verifier rejects floating action references", async () => {
  const workflow = await readFile(workflowPath, "utf8")
  assert.throws(
    () => verifyWorkflowText(workflow.replace("actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683", "actions/checkout@v4")),
    /action reference is not pinned/,
  )
})

test("workflow verifier rejects automatic merge", async () => {
  const workflow = await readFile(workflowPath, "utf8")
  assert.throws(
    () => verifyWorkflowText(`${workflow}\n      - run: gh pr merge --merge\n`),
    /automatic merge is forbidden/,
  )
})
