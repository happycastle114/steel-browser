import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ACTION_SHA_PATTERN = /^[0-9a-f]{40}$/u

function requireMatch(workflow, pattern, detail) {
  if (!pattern.test(workflow)) throw new Error(detail)
}

function extractJob(workflow, jobName) {
  const jobPattern = new RegExp(`^  ${jobName}:\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:\\n|(?![\\s\\S]))`, "mu")
  const match = workflow.match(jobPattern)
  if (match === null) throw new Error(`${jobName} job is missing`)
  return match[1]
}

function extractExecutableCandidateStep(candidateJob) {
  const stepStart = candidateJob.indexOf("- name: Resolve and test an unprivileged candidate")
  if (stepStart === -1) throw new Error("candidate executable step is missing")
  const remaining = candidateJob.slice(stepStart)
  const nextStep = remaining.search(/\n\s{6}- name:/u)
  const step = nextStep === -1 ? remaining : remaining.slice(0, nextStep)
  const runStart = step.indexOf("\n        run: |\n")
  if (runStart === -1) throw new Error("candidate executable step must use a multiline run block")
  return step.slice(runStart + "\n        run: |\n".length)
}

function verifyExecutableCandidateGates(workflow) {
  const candidate = extractJob(workflow, "candidate")
  const executable = extractExecutableCandidateStep(candidate)
  const executableLines = executable.split("\n").map((line) => line.trim())
  const hasExecutableCommand = (command) => executableLines.some((line) => line === command || line.startsWith(`${command} `) || line.startsWith(`${command}&&`) || line.startsWith(`${command}||`))
  for (const gate of ["npm run check:managed", "npm run test", "npm run build", "node scripts/upstream-sync/verify-license.mjs", "git diff --check", "node scripts/upstream-sync/verify-candidate-commit.mjs"]) {
    if (!hasExecutableCommand(gate)) throw new Error(`candidate gate is missing from the executable candidate step: ${gate}`)
  }
  if (!/if \[\[ -n "\$\(git status --porcelain\)" \]\]; then/u.test(executable)) {
    throw new Error("candidate clean-tree check is missing from the executable candidate step")
  }
  const finalVerifierIndex = executable.indexOf("node scripts/upstream-sync/verify-candidate-commit.mjs")
  const lastGateIndex = Math.max(...["npm run check:managed", "npm run test", "npm run build", "node scripts/upstream-sync/verify-license.mjs", "git diff --check"].map((gate) => executable.lastIndexOf(gate)))
  if (finalVerifierIndex < lastGateIndex) throw new Error("candidate commit verifier must run after all executable gates")
}

function verifyPermissions(workflow) {
  requireMatch(workflow, /^permissions:\s*\{\}\s*$/mu, "workflow default permissions must be read-only")
  const candidate = extractJob(workflow, "candidate")
  requireMatch(candidate, /^    permissions:\n      contents:\s*read\s*$/mu, "candidate job must use read-only contents permission")
  if (/^      (?:pull-requests|actions|contents):\s*write\s*$/mu.test(candidate)) {
    throw new Error("candidate job must use read-only contents permission")
  }
  const publisher = extractJob(workflow, "publish")
  requireMatch(publisher, /^    permissions:\n      contents:\s*write\n      pull-requests:\s*write\s*$/mu, "publisher job must own the narrow write permissions")
  const blockedReport = extractJob(workflow, "report-blocked")
  requireMatch(blockedReport, /^    permissions:\n      contents:\s*read\n      issues:\s*write\s*$/mu, "blocked report job must own only issue write permission")
}

function verifyActions(workflow) {
  const references = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)\s*$/gmu)].map((match) => match[1])
  if (references.length === 0) throw new Error("workflow has no actions")
  for (const reference of references) {
    const atIndex = reference.lastIndexOf("@")
    const sha = atIndex === -1 ? "" : reference.slice(atIndex + 1)
    if (!ACTION_SHA_PATTERN.test(sha)) throw new Error(`action reference is not pinned: ${reference}`)
  }
}

function verifyCandidateOrdering(workflow) {
  const candidate = extractJob(workflow, "candidate")
  const guardCalls = [...candidate.matchAll(/^          verify_upstream_delta\s*$/gmu)].map((match) => match.index)
  if (guardCalls.length < 2) throw new Error("candidate must guard upstream-owned paths before and after merge")
  const mergeIndex = candidate.indexOf("git merge --no-edit --no-ff")
  const installIndex = candidate.indexOf("npm ci")
  const credentialClearIndex = candidate.indexOf("unset READ_TOKEN GITHUB_TOKEN GH_TOKEN PUBLISH_TOKEN ACTIONS_RUNTIME_TOKEN")
  if (mergeIndex === -1 || installIndex === -1 || credentialClearIndex === -1 || guardCalls[0] > mergeIndex || credentialClearIndex > installIndex || guardCalls[1] > installIndex) {
    throw new Error("candidate fork-owned-path guard must run before candidate install")
  }
  const prepareIndex = candidate.indexOf("prepare-corpus.mjs")
  const generatedGuardIndex = candidate.indexOf("verify_generated_worktree")
  const commitIndex = candidate.indexOf('git commit -m "ci(managed): record observed upstream corpus ${SOURCE_SHA}"')
  if (prepareIndex === -1 || generatedGuardIndex === -1 || commitIndex === -1 || prepareIndex > generatedGuardIndex || generatedGuardIndex > commitIndex) {
    throw new Error("generated candidate changes must be guarded and committed in order")
  }
  verifyExecutableCandidateGates(workflow)
}

export function verifyWorkflowText(workflow) {
  verifyPermissions(workflow)
  verifyActions(workflow)
  verifyCandidateOrdering(workflow)
  requireMatch(workflow, /^on:\n(?=[\s\S]*^  schedule:\n)(?=[\s\S]*^  workflow_dispatch:\s*$)/mu, "workflow must expose weekly schedule and workflow_dispatch")
  requireMatch(workflow, /^\s*-?\s*cron:\s*['"]\S+\s+\S+\s+\S+\s+\S+\s+\S+['"]\s*$/mu, "workflow schedule must use a five-field cron")
  requireMatch(workflow, /^concurrency:\n\s+group:\s+steel-managed-upstream-sync\n\s+cancel-in-progress:\s+false\s*$/mu, "workflow concurrency must serialize runs")
  requireMatch(workflow, /https:\/\/github\.com\/steel-dev\/steel-browser\.git/u, "canonical upstream URL is missing")
  requireMatch(workflow, /git ls-remote --symref .*UPSTREAM_URL.* HEAD/u, "upstream default branch must be resolved from the canonical remote")
  requireMatch(workflow, /git check-ref-format "refs\/heads\/\$\{UPSTREAM_DEFAULT_BRANCH\}"/u, "upstream default branch must pass git ref validation")
  requireMatch(workflow, /git fetch --no-tags upstream "\$\{UPSTREAM_DEFAULT_BRANCH\}"/u, "upstream default branch must be fetched without tags")
  requireMatch(workflow, /git merge --no-edit --no-ff/u, "candidate must merge upstream without rebase")
  requireMatch(workflow, /MIRROR_BRANCH:\s*main/u, "protected main mirror is missing")
  if (/upstream-main/u.test(workflow)) throw new Error("unprotected upstream-main mirror is forbidden")
  requireMatch(workflow, /SYNC_BRANCH="upstream-sync\/\$\{SOURCE_SHA\}"/u, "sync branch must include exact source SHA")
  requireMatch(workflow, /Source SHA:\s+\\?`\$\{SOURCE_SHA\}\\?`/u, "PR body must include exact source SHA")
  requireMatch(workflow, /--head "\$\{GITHUB_REPOSITORY_OWNER\}:\$\{SYNC_BRANCH\}"/u, "PR head must be fork-qualified")
  requireMatch(workflow, /--base "\$\{MANAGED_BRANCH\}"/u, "PR base must be protected managed")
  requireMatch(workflow, /gh pr (?:create|edit)/u, "workflow must create or update a reviewed PR")
  requireMatch(workflow, /npm run verify:upstream-corpus/u, "corpus compatibility check is missing")
  requireMatch(workflow, /npm run check:managed/u, "managed check is missing")
  requireMatch(workflow, /npm run test\b/u, "root test is missing")
  requireMatch(workflow, /npm run build\b/u, "root build is missing")
  requireMatch(workflow, /npm ci/u, "candidate dependencies must be installed from the lockfile")
  requireMatch(workflow, /unset READ_TOKEN GITHUB_TOKEN GH_TOKEN PUBLISH_TOKEN ACTIONS_RUNTIME_TOKEN/u, "candidate credentials must be cleared before untrusted code runs")
  requireMatch(workflow, /managed\/shared\/src\/upstream-observed-receipt\.ts/u, "source-pinned receipt update allowlist is missing")
  requireMatch(workflow, /--observed-corpus-directory/u, "corpus preparation must use a captured observation")
  requireMatch(workflow, /classify-upstream\.mjs/u, "upstream API/browser/license/migration classification is missing")
  requireMatch(workflow, /blockedReasons/u, "blocked classification reasons must be published")
  if (/git add --[^\n]*\.github\/workflows\/upstream-sync\.yml/u.test(workflow)) {
    throw new Error("workflow file may not be part of generated candidate changes")
  }
  requireMatch(workflow, /git add -- managed\/upstream\.lock\.json "managed\/tests\/upstream\/\$\{SOURCE_SHA\}" managed\/shared\/src\/upstream-observed-receipt\.ts/u, "generated candidate paths must be explicitly staged")
  requireMatch(workflow, /git commit -m "ci\(managed\): record observed upstream corpus \$\{SOURCE_SHA\}"/u, "generated candidate changes must be committed")
  requireMatch(workflow, /git diff-tree --no-commit-id --name-only -r HEAD/u, "committed generated tree must be inspected")
  requireMatch(workflow, /git bundle create [^\n]*candidate\.bundle/u, "candidate bundle must be created from the verified commit")
  requireMatch(workflow, /git bundle verify/u, "publisher must verify the candidate bundle")
  requireMatch(workflow, /verify-candidate-commit\.mjs/u, "publisher must verify the candidate commit with the production verifier")
  requireMatch(workflow, /refs\/remotes\/upstream\/\$\{UPSTREAM_DEFAULT_BRANCH\}.*META_SOURCE_SHA/u, "publisher must re-read the exact upstream source SHA")
  requireMatch(workflow, /EXISTING_TIP[\s\S]*verify-candidate-commit\.mjs/u, "existing candidate refs must have exact one-commit provenance")
  requireMatch(workflow, /META_BRANCH.*\^upstream-sync\/\[0-9a-f\]\{40\}\$/u, "publisher must validate the content-addressed candidate branch")
  requireMatch(workflow, /persist-credentials:\s*false/u, "checkout credentials must not persist")
  requireMatch(workflow, /RECOVERY_BRANCH="\$\{META_BRANCH\}-\$\{MANAGED_SHA\}"/u, "stale candidate refs must recover on a managed-base-qualified branch")
  requireMatch(workflow, /git -c "http\.extraheader=AUTHORIZATION: bearer \$\{PUBLISH_TOKEN\}" push origin "\$\{SOURCE_SHA\}:refs\/heads\/\$\{MIRROR_BRANCH\}"/u, "mirror push must be fast-forward-only")
  requireMatch(workflow, /managed\/tests\/upstream\/\$\{SOURCE_SHA\}\/\*/u, "candidate corpus path must be source-SHA scoped")
  requireMatch(workflow, /\.github\/workflows\/upstream-sync\.yml/u, "workflow self-modification guard is missing")
  if (/managed\/upstream\.lock\.json\|managed\/shared\/src\/upstream-observed-receipt\.ts\|\.github\/workflows\/upstream-sync\.yml/u.test(workflow)) {
    throw new Error("workflow file may not be part of generated candidate changes")
  }
  if (/\bgit\s+rebase\b/u.test(workflow) || /\bgit\s+(?:push|fetch|merge)[^\n]*--force\b/u.test(workflow)) {
    throw new Error("force push/rebase is forbidden")
  }
  if (/gh\s+pr\s+merge\b/u.test(workflow) || /enable-auto-merge/u.test(workflow)) {
    throw new Error("automatic merge is forbidden")
  }
  if (/\b(?:set -x|echo\s+.*(?:GITHUB_TOKEN|GH_TOKEN)|printenv)\b/u.test(workflow)) {
    throw new Error("workflow may not log secrets")
  }
  if (/git\s+push[^\n]*refs\/heads\/managed\b/u.test(workflow)) {
    throw new Error("workflow may not push protected managed")
  }
  if (/git\s+fetch[^\n]*\|\|\s*true/u.test(workflow)) {
    throw new Error("remote fetch failures may not be treated as missing refs")
  }
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
