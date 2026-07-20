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

test("workflow verifier rejects candidate publication without an exact committed bundle", async () => {
  const workflow = await readFile(workflowPath, "utf8")
  assert.throws(
    () => verifyWorkflowText(workflow.replace(/git bundle create [^\n]+\n/u, "")),
    /candidate bundle must be created from the verified commit/,
  )
})

test("workflow verifier rejects workflow self-modification in the generated allowlist", async () => {
  const workflow = await readFile(workflowPath, "utf8")
  assert.throws(
    () => verifyWorkflowText(workflow.replace("git add -- managed/upstream.lock.json", "git add -- .github/workflows/upstream-sync.yml")),
    /workflow file may not be part of generated candidate changes/,
  )
})

test("workflow verifier rejects a write permission on the candidate job", async () => {
  const workflow = await readFile(workflowPath, "utf8")
  assert.throws(
    () => verifyWorkflowText(workflow.replace("      contents: read", "      contents: write")),
    /candidate job must use read-only contents permission/,
  )
})

test("workflow verifier rejects unused guard definitions with no candidate call sites", async () => {
  const workflow = await readFile(workflowPath, "utf8")
  assert.throws(
    () => verifyWorkflowText(workflow.replace(/^          verify_upstream_delta\s*$/gmu, "")),
    /candidate must guard upstream-owned paths before and after merge/,
  )
})
