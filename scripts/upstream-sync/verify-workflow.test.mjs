import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

import { verifyWorkflowText } from "./verify-workflow.mjs"

const workflowPath = path.resolve(".github/workflows/upstream-sync.yml")
const candidatePath = path.resolve("scripts/upstream-sync/candidate.sh")
const publisherPath = path.resolve("scripts/upstream-sync/publisher.sh")

async function inputs() {
  return {
    workflow: await readFile(workflowPath, "utf8"),
    candidateScript: await readFile(candidatePath, "utf8"),
    publisherScript: await readFile(publisherPath, "utf8"),
  }
}

test("upstream sync workflow satisfies the reviewed contract", async () => {
  assert.deepEqual(verifyWorkflowText((await inputs()).workflow), { status: "VERIFIED" })
})

test("workflow verifier rejects floating action references", async () => {
  const { workflow } = await inputs()
  assert.throws(() => verifyWorkflowText(workflow.replace("actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683", "actions/checkout@v4")), /action reference is not pinned/)
})

test("workflow verifier rejects automatic merge", async () => {
  const { workflow } = await inputs()
  assert.throws(() => verifyWorkflowText(`${workflow}\n      - run: gh pr merge --merge\n`), /force merge\/rebase automation is forbidden/)
})

test("workflow verifier rejects candidate publication without an exact committed bundle", async () => {
  const { workflow, candidateScript } = await inputs()
  assert.throws(() => verifyWorkflowText(workflow, { candidateScript: candidateScript.replace(/git bundle create [^\n]+\n/u, "") }), /candidate gate is missing from the candidate script/)
})

test("workflow verifier rejects workflow self-modification in the generated allowlist", async () => {
  const { workflow, candidateScript } = await inputs()
  assert.throws(() => verifyWorkflowText(workflow, { candidateScript: candidateScript.replace("git add -- managed/upstream.lock.json", "git add -- .github/workflows/upstream-sync.yml") }), /generated candidate allowlist must stage the managed corpus/)
})

test("workflow verifier rejects a write permission on the candidate job", async () => {
  const { workflow } = await inputs()
  assert.throws(() => verifyWorkflowText(workflow.replace("      contents: read", "      contents: write")), /candidate job must use read-only contents permission/)
})

test("workflow verifier rejects unused guard definitions with no candidate call sites", async () => {
  const { workflow, candidateScript } = await inputs()
  assert.throws(() => verifyWorkflowText(workflow, { candidateScript: candidateScript.replace(/^verify_upstream_delta\s*$/gmu, "") }), /candidate must guard upstream-owned paths before and after merge/)
})

test("workflow verifier rejects removal of the actual candidate gates", async () => {
  const { workflow, candidateScript } = await inputs()
  for (const gate of ["npm run check:managed", "npm run test", "npm run build", "node scripts/upstream-sync/verify-license.mjs", "git diff --check HEAD^ HEAD"]) {
    assert.throws(() => verifyWorkflowText(workflow, { candidateScript: candidateScript.replace(`${gate}\n`, "") }), /candidate gate is missing from the candidate script/, gate)
  }
})

test("workflow verifier rejects removal of the staged/generated tree oracle", async () => {
  const { workflow, candidateScript } = await inputs()
  assert.throws(() => verifyWorkflowText(workflow, { candidateScript: candidateScript.replace('STAGED_TREE_SHA="$(git write-tree)"\n', "") }), /candidate must snapshot the staged generated tree/)
})

test("workflow verifier rejects a gate neutralized with a successful fallback", async () => {
  const { workflow, candidateScript } = await inputs()
  assert.throws(() => verifyWorkflowText(workflow, { candidateScript: candidateScript.replace("npm run test\n", "npm run test || true\n") }), /failure neutralizer/)
})
