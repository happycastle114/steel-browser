import { readFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { GATE_COMMANDS, hasGateCommand, verifyFailClosedGates } from "./verify-shell-gates.mjs"

const ACTION_SHA_PATTERN = /^[0-9a-f]{40}$/u
const SCRIPT_ROOT = path.resolve(process.cwd(), "scripts", "upstream-sync")

function requireMatch(value, pattern, detail) {
  if (!pattern.test(value)) throw new Error(detail)
}

function extractJob(workflow, jobName) {
  const jobPattern = new RegExp(`^  ${jobName}:\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:\\n|(?![\\s\\S]))`, "mu")
  const match = workflow.match(jobPattern)
  if (match === null) throw new Error(`${jobName} job is missing`)
  return match[1]
}

function loadScripts(options = {}) {
  return {
    candidate: options.candidateScript ?? readFileSync(path.join(SCRIPT_ROOT, "candidate.sh"), "utf8"),
    publisher: options.publisherScript ?? readFileSync(path.join(SCRIPT_ROOT, "publisher.sh"), "utf8"),
  }
}

function verifyActions(workflow) {
  const references = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)\s*$/gmu)].map((match) => match[1])
  if (references.length === 0) throw new Error("workflow has no actions")
  for (const reference of references) {
    const sha = reference.slice(reference.lastIndexOf("@") + 1)
    if (!ACTION_SHA_PATTERN.test(sha)) throw new Error(`action reference is not pinned: ${reference}`)
  }
}

function verifyPermissions(workflow) {
  requireMatch(workflow, /^permissions:\s*\{\}\s*$/mu, "workflow default permissions must be read-only")
  const candidate = extractJob(workflow, "candidate")
  requireMatch(candidate, /^    permissions:\n      contents:\s*read\s*$/mu, "candidate job must use read-only contents permission")
  if (/^      (?:pull-requests|actions|contents):\s*write\s*$/mu.test(candidate)) throw new Error("candidate job must use read-only contents permission")
  const publisher = extractJob(workflow, "publish")
  requireMatch(publisher, /^    permissions:\n      contents:\s*write\n      pull-requests:\s*write\s*$/mu, "publisher job must own the narrow write permissions")
  const blocked = extractJob(workflow, "report-blocked")
  requireMatch(blocked, /^    permissions:\n      contents:\s*read\n      issues:\s*write\s*$/mu, "blocked report job must own only issue write permission")
}

function verifyCandidateScript(candidate) {
  requireMatch(candidate, /^#!\/usr\/bin\/env bash\nset -euo pipefail/u, "candidate script must fail closed")
  for (const command of GATE_COMMANDS) {
    if (!hasGateCommand(candidate, command)) throw new Error(`candidate gate is missing from the candidate script: ${command.join(" ")}`)
  }
  for (const gate of ["node scripts/upstream-sync/verify-candidate-commit.mjs", "git bundle create"]) {
    if (!new RegExp(`^${gate.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:\\s|$)`, "mu").test(candidate)) throw new Error(`candidate gate is missing from the candidate script: ${gate}`)
  }
  verifyFailClosedGates(candidate)
  requireMatch(candidate, /STAGED_TREE_SHA="\$\(git write-tree\)"/u, "candidate must snapshot the staged generated tree")
  requireMatch(candidate, /COMMITTED_TREE_SHA="\$\(git rev-parse HEAD\^\{tree\}\)"[\s\S]*STAGED_TREE_SHA/u, "candidate must bind the committed tree to the staged generated tree")
  requireMatch(candidate, /if \[\[ -n "\$\(git status --porcelain=v1 --untracked-files=all\)" \]\]; then/u, "candidate clean-tree check is missing")
  requireMatch(candidate, /STEEL_REVIEWED_CAPTURE_EXECUTABLE/u, "candidate must require a reviewed Steel capture executable")
  requireMatch(candidate, /capture-observation\.mjs/u, "candidate must execute the deterministic observation capture")
  requireMatch(candidate, /CAPTURE_SCRIPT="\$\{ARTIFACT_ROOT\}\/capture-observation\.mjs"[\s\S]*cp scripts\/upstream-sync\/capture-observation\.mjs "\$\{CAPTURE_SCRIPT\}"/u, "candidate must preserve the capture tool across the source checkout")
  requireMatch(candidate, /git switch --detach "\$\{SOURCE_SHA\}"[\s\S]*node "\$\{CAPTURE_SCRIPT\}"/u, "candidate must capture against the exact source checkout")
  requireMatch(candidate, /copied corpora are not accepted/u, "candidate must reject copied corpus inputs")
  if (/OBSERVED_CORPUS_ROOT|upstream-observations/u.test(candidate)) throw new Error("candidate must not consume an ambiguously named copied corpus")
  requireMatch(candidate, /git add -- managed\/upstream\.lock\.json/u, "generated candidate allowlist must stage the managed corpus")
  if (/git add -- \.github\/workflows\/upstream-sync\.yml/u.test(candidate)) throw new Error("workflow file may not be part of generated candidate changes")
  const guards = [...candidate.matchAll(/^verify_upstream_delta\s*$/gmu)].map((match) => match.index)
  if (guards.length < 2) throw new Error("candidate must guard upstream-owned paths before and after merge")
  const mergeIndex = candidate.indexOf("git merge --no-edit --no-ff")
  const installIndex = candidate.indexOf("npm ci")
  const prepareIndex = candidate.indexOf("prepare-corpus.mjs")
  const commitIndex = candidate.indexOf('git commit -m "ci(managed): record observed upstream corpus ${SOURCE_SHA}"')
  const finalVerifierIndex = candidate.indexOf("node scripts/upstream-sync/verify-candidate-commit.mjs")
  requireMatch(candidate, /git diff --check "\$\{MANAGED_SHA\}\.\.\.HEAD"/u, "candidate must check the full managed-to-candidate range")
  const lastGateIndex = Math.max(...["npm run check:managed", "npm run test", "npm run build", "node scripts/upstream-sync/verify-license.mjs", "git diff --check"].map((gate) => candidate.lastIndexOf(gate)))
  if (mergeIndex === -1 || installIndex === -1 || guards[0] > mergeIndex || guards[1] > installIndex) throw new Error("candidate fork-owned-path guard must run before candidate install")
  if (prepareIndex === -1 || commitIndex === -1 || prepareIndex > commitIndex) throw new Error("generated candidate changes must be prepared before commit")
  if (finalVerifierIndex < lastGateIndex) throw new Error("candidate commit verifier must run after all executable gates")
}

function verifyPublisherScript(publisher) {
  requireMatch(publisher, /^#!\/usr\/bin\/env bash\nset -euo pipefail/u, "publisher script must fail closed")
  for (const pattern of [
    /git bundle verify/u,
    /verify-candidate-commit\.mjs/u,
    /verify-repository-rules\.mjs --repository/u,
    /git ls-remote --symref .*UPSTREAM_URL.* HEAD/u,
    /git check-ref-format "refs\/heads\/\$\{UPSTREAM_DEFAULT_BRANCH\}"/u,
    /push origin "\$\{SOURCE_SHA\}:refs\/heads\/\$\{MIRROR_BRANCH\}"/u,
    /gh pr (?:create|edit)/u,
    /managed pull request could not be read back/u,
  ]) requireMatch(publisher, pattern, `publisher script contract is missing: ${pattern}`)
  requireMatch(publisher, /META_BRANCH.*\^upstream-sync\/\[0-9a-f\]\{40\}-\[0-9a-f\]\{40\}\$/u, "publisher must validate source-and-managed candidate branches")
  requireMatch(publisher, /RECOVERY_BRANCH="\$\{META_BRANCH\}-\$\{META_COMMIT_SHA\}"/u, "publisher recovery branch must bind candidate commit")
  requireMatch(publisher, /required checks and immutable upstream-sync refs/u, "publisher PR evidence must describe enforced repository rules")
  if (/gh\s+pr\s+merge\b/u.test(publisher) || /enable-auto-merge/u.test(publisher) || /git\s+rebase\b/u.test(publisher)) throw new Error("publisher may not merge, rebase, or auto-merge")
  if (/git\s+push[^\n]*refs\/heads\/managed\b/u.test(publisher)) throw new Error("publisher may not push protected managed")
}

export function verifyManagedPrGateText(workflow) {
  verifyActions(workflow)
  requireMatch(workflow, /^on:\n\s+pull_request:\n\s+branches:\n\s+- managed\s*$/mu, "managed PR gate must target pull requests to managed")
  requireMatch(workflow, /node-version:\s*22\.23\.1/u, "managed PR gate must use Node 22.23.1")
  requireMatch(workflow, /PR_BASE_SHA:\s*\$\{\{ github\.event\.pull_request\.base\.sha \}\}/u, "managed PR gate must bind the pull request base SHA")
  requireMatch(workflow, /if \[\[ ! "\$\{PR_BASE_SHA\}" =~ \^\[0-9a-f\]\{40\}\$ \]\]; then/u, "managed PR gate must validate the base SHA")
  requireMatch(workflow, /git fetch --no-tags origin "\$\{PR_BASE_SHA\}"/u, "managed PR gate must fetch the exact base SHA")
  if (/^\s*git diff --check\s*$/mu.test(workflow)) throw new Error("managed PR gate may not inspect an empty worktree diff")
  requireMatch(workflow, /git diff --check "\$\{PR_BASE_SHA\}\.\.\.HEAD"/u, "managed PR gate must check the pull request range")
  for (const gate of ["node scripts/upstream-sync/verify-workflow.mjs", "node --test scripts/upstream-sync/*.test.mjs", "npm run verify:upstream-corpus", "npm run check:managed", "npm run test", "npm run build", "node scripts/upstream-sync/verify-license.mjs"]) {
    requireMatch(workflow, new RegExp(`^\\s*${gate.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:\\s|$)`, "mu"), `managed PR gate is missing: ${gate}`)
  }
  return { status: "VERIFIED" }
}

export function verifyWorkflowText(workflow, options = {}) {
  const scripts = loadScripts(options)
  verifyPermissions(workflow)
  verifyActions(workflow)
  const candidate = extractJob(workflow, "candidate")
  const publisher = extractJob(workflow, "publish")
  requireMatch(candidate, /run:\s+bash scripts\/upstream-sync\/candidate\.sh/u, "candidate must invoke the reviewed candidate script")
  requireMatch(publisher, /run:\s+bash scripts\/upstream-sync\/publisher\.sh/u, "publisher must invoke the reviewed publisher script")
  verifyCandidateScript(scripts.candidate)
  verifyPublisherScript(scripts.publisher)
  requireMatch(workflow, /^on:\n(?=[\s\S]*^  schedule:\n)(?=[\s\S]*^  workflow_dispatch:\s*$)/mu, "workflow must expose weekly schedule and workflow_dispatch")
  requireMatch(workflow, /^\s*-?\s*cron:\s*['"]\S+\s+\S+\s+\S+\s+\S+\s+\S+['"]\s*$/mu, "workflow schedule must use a five-field cron")
  requireMatch(workflow, /^concurrency:\n\s+group:\s+steel-managed-upstream-sync\n\s+cancel-in-progress:\s+false\s*$/mu, "workflow concurrency must serialize runs")
  requireMatch(workflow, /REVIEW_ACKNOWLEDGEMENT_ROOT/u, "review acknowledgement root is missing")
  requireMatch(workflow, /actions\/upload-artifact@/u, "candidate evidence upload is missing")
  requireMatch(workflow, /actions\/download-artifact@/u, "publisher evidence download is missing")
  requireMatch(workflow, /if: needs\.candidate\.outputs\.sync_status == 'blocked'/u, "blocked classification reporting is missing")
  requireMatch(workflow, /UPSTREAM_URL:\s*https:\/\/github\.com\/steel-dev\/steel-browser\.git/u, "canonical upstream URL is missing")
  requireMatch(scripts.candidate, /git fetch --no-tags upstream "\$\{UPSTREAM_DEFAULT_BRANCH\}"/u, "upstream default branch must be fetched without tags")
  requireMatch(scripts.candidate, /git merge --no-edit --no-ff/u, "candidate must merge upstream without rebase")
  requireMatch(scripts.candidate, /managed\/shared\/src\/upstream-observed-receipt\.ts/u, "source-pinned receipt update allowlist is missing")
  requireMatch(scripts.candidate, /--observed-corpus-directory/u, "corpus preparation must use captured output")
  requireMatch(scripts.candidate, /classify-upstream\.mjs/u, "upstream classification is missing")
  requireMatch(scripts.publisher, /npm run verify:upstream-corpus/u, "corpus compatibility check evidence is missing")
  requireMatch(scripts.publisher, /npm run check:managed/u, "managed check evidence is missing")
  requireMatch(scripts.publisher, /npm run test\b/u, "root test evidence is missing")
  requireMatch(scripts.publisher, /npm run build\b/u, "root build evidence is missing")
  requireMatch(scripts.candidate, /npm ci/u, "candidate dependencies must be installed from the lockfile")
  if (/(?:git\s+rebase|gh\s+pr\s+merge|enable-auto-merge)/u.test(`${workflow}\n${scripts.candidate}\n${scripts.publisher}`)) throw new Error("force merge/rebase automation is forbidden")
  if (/git\s+fetch[^\n]*\|\|\s*true/u.test(`${scripts.candidate}\n${scripts.publisher}`)) throw new Error("remote fetch failures may not be treated as missing refs")
  return { status: "VERIFIED" }
}

async function main() {
  const workflowPath = path.resolve(process.cwd(), ".github", "workflows", "upstream-sync.yml")
  const workflow = await readFile(workflowPath, "utf8")
  console.log(`UPSTREAM_SYNC_WORKFLOW_VERIFIED ${JSON.stringify(verifyWorkflowText(workflow))}`)
}

if (process.argv[1] !== undefined && path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "unknown workflow verification failure")
    process.exitCode = 1
  })
}
