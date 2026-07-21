import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { access, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { promisify } from "node:util"

import { verifyManagedPrGateText, verifyWorkflowText } from "./verify-workflow.mjs"

const execFileAsync = promisify(execFile)

const workflowPath = path.resolve(".github/workflows/upstream-sync.yml")
const managedPrWorkflowPath = path.resolve(".github/workflows/managed-pr-gates.yml")
const candidatePath = path.resolve("scripts/upstream-sync/candidate.sh")
const publisherPath = path.resolve("scripts/upstream-sync/publisher.sh")

async function inputs() {
  return {
    workflow: await readFile(workflowPath, "utf8"),
    managedPrWorkflow: await readFile(managedPrWorkflowPath, "utf8"),
    candidateScript: await readFile(candidatePath, "utf8"),
    publisherScript: await readFile(publisherPath, "utf8"),
  }
}

test("managed PR gate binds whitespace checks to the pull request range", async () => {
  const { managedPrWorkflow } = await inputs()
  assert.deepEqual(verifyManagedPrGateText(managedPrWorkflow), { status: "VERIFIED" })
})

test("managed PR gate rejects a tautological empty-worktree diff check", async () => {
  const { managedPrWorkflow } = await inputs()
  assert.throws(() => verifyManagedPrGateText(managedPrWorkflow.replace('git diff --check "${PR_BASE_SHA}...HEAD"', "git diff --check")), /empty worktree diff/)
})

test("managed PR gate requires the exact root test command", async () => {
  const { managedPrWorkflow } = await inputs()
  assert.throws(() => verifyManagedPrGateText(managedPrWorkflow.replace(/^\s+npm run test$/mu, "          npm run test:managed")), /missing: npm run test$/)
})

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
  for (const gate of ["npm run check:managed", "npm run test", "npm run build", "node scripts/upstream-sync/verify-license.mjs", 'git diff --check "${MANAGED_SHA}...HEAD"']) {
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

test("workflow verifier rejects tokenized gate neutralizers across shell forms", async () => {
  const { workflow, candidateScript } = await inputs()
  const neutralizers = [
    "npm run test || :",
    "npm run test || exit 0",
    "npm run test || { echo ignored; }",
    "npm run test && echo ignored",
    "npm run test && false",
    "npm run test && exit 1",
    "npm run test | tee /tmp/test.log",
    "npm run test &",
    "(npm run test) || :",
    "(npm run test) && echo ignored",
    "npm run test; npm run build || :",
    "run_gate() { npm run test; }; run_gate || :",
    "run_gate() {\n  npm run test\n}\nrun_gate && echo ignored",
    "npm run test \\\n|| :",
    "(npm run test)\n|| :",
    "if npm run test; then echo ignored; fi",
    "if\n  npm run test\nthen\n  echo ignored\nfi",
    "while\n  npm run test\ndo\n  echo ignored\ndone",
    "until\n  npm run test\ndo\n  echo ignored\ndone",
    "(\n  npm run test\n)\n|| :",
    "{\n  npm run test\n}\n|| :",
    "! npm run test",
  ]
  for (const neutralizer of neutralizers) {
    assert.throws(
      () => verifyWorkflowText(workflow, { candidateScript: candidateScript.replace("npm run test\n", `${neutralizer}\n`) }),
      /failure neutralizer/,
      neutralizer,
    )
  }
})

test("bash execution oracle confirms fail-open and fail-closed sentinel behavior", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "steel-shell-gate-oracle-"))
  const sentinel = path.join(root, "sentinel")
  t.after(() => rm(root, { recursive: true, force: true }))
  await execFileAsync("bash", ["-euo", "pipefail", "-c", `false || :; touch ${sentinel}`])
  await access(sentinel)
  await rm(sentinel)
  await assert.rejects(execFileAsync("bash", ["-euo", "pipefail", "-c", `false || { exit 1; }; touch ${sentinel}`]))
  await assert.rejects(access(sentinel))
  await execFileAsync("bash", ["-euo", "pipefail", "-c", `true; touch ${sentinel}`])
  assert.equal((await readFile(sentinel)).length, 0)
})

test("workflow verifier does not count gate text inside another command", async () => {
  const { workflow, candidateScript } = await inputs()
  assert.throws(
    () => verifyWorkflowText(workflow, { candidateScript: candidateScript.replace("npm run test\n", "echo npm run test\n") }),
    /candidate gate is missing from the candidate script: npm run test/,
  )
})

test("workflow verifier preserves explicit fail-closed shell branches", async () => {
  const { workflow, candidateScript } = await inputs()
  const failClosed = [
    "npm run test || exit 1",
    "npm run test || { echo failed >&2; exit 1; }",
    "npm run test || {\n  echo failed >&2\n  exit 1\n}",
  ]
  for (const branch of failClosed) {
    assert.deepEqual(verifyWorkflowText(workflow, { candidateScript: candidateScript.replace("npm run test\n", `${branch}\n`) }), { status: "VERIFIED" }, branch)
  }
})
