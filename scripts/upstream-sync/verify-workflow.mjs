import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ACTION_SHA_PATTERN = /^[0-9a-f]{40}$/u
const REQUIRED_PERMISSIONS = new Map([
  ["contents", "write"],
  ["pull-requests", "write"],
])

function requireMatch(workflow, pattern, detail) {
  if (!pattern.test(workflow)) throw new Error(detail)
}

function verifyPermissions(workflow) {
  const match = workflow.match(/(?:^|\n)permissions:\n((?: {2}[a-z-]+:\s*(?:read|write|none)\s*\n)+)/u)
  if (match === null) throw new Error("workflow permissions block is missing")
  const entries = new Map()
  for (const line of match[1].trimEnd().split("\n")) {
    const [, key, value] = line.match(/^\s{2}([a-z-]+):\s*(read|write|none)\s*$/u) ?? []
    if (key === undefined || value === undefined) throw new Error(`invalid workflow permission line: ${line}`)
    entries.set(key, value)
  }
  if (entries.size !== REQUIRED_PERMISSIONS.size) throw new Error("workflow permissions are broader than the sync contract")
  for (const [key, value] of REQUIRED_PERMISSIONS) {
    if (entries.get(key) !== value) throw new Error(`workflow permission drift: ${key}`)
  }
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

export function verifyWorkflowText(workflow) {
  verifyPermissions(workflow)
  verifyActions(workflow)
  requireMatch(workflow, /^on:\n(?=[\s\S]*^  schedule:\n)(?=[\s\S]*^  workflow_dispatch:\s*$)/mu, "workflow must expose weekly schedule and workflow_dispatch")
  requireMatch(workflow, /^\s*-?\s*cron:\s*['"]\S+\s+\S+\s+\S+\s+\S+\s+\S+['"]\s*$/mu, "workflow schedule must use a five-field cron")
  requireMatch(workflow, /^concurrency:\n\s+group:\s+steel-managed-upstream-sync\n\s+cancel-in-progress:\s+false\s*$/mu, "workflow concurrency must serialize runs")
  requireMatch(workflow, /https:\/\/github\.com\/steel-dev\/steel-browser\.git/u, "canonical upstream URL is missing")
  requireMatch(workflow, /git ls-remote --symref .*UPSTREAM_URL.* HEAD/u, "upstream default branch must be resolved from the canonical remote")
  requireMatch(workflow, /git fetch --no-tags upstream "\$\{UPSTREAM_DEFAULT_BRANCH\}"/u, "upstream default branch must be fetched without tags")
  requireMatch(workflow, /git merge --no-edit --no-ff/u, "candidate must merge upstream without rebase")
  requireMatch(workflow, /refs\/heads\/upstream-main/u, "upstream-main mirror ref is missing")
  requireMatch(workflow, /SYNC_BRANCH="upstream-sync\/\$\{SOURCE_SHA\}"/u, "sync branch must include exact source SHA")
  requireMatch(workflow, /Source SHA:\s+\\?`\$\{SOURCE_SHA\}\\?`/u, "PR body must include exact source SHA")
  requireMatch(workflow, /--head "\$\{GITHUB_REPOSITORY_OWNER\}:\$\{SYNC_BRANCH\}"/u, "PR head must be fork-qualified")
  requireMatch(workflow, /--base managed/u, "PR base must be protected managed")
  requireMatch(workflow, /gh pr (?:create|edit)/u, "workflow must create or update a reviewed PR")
  requireMatch(workflow, /npm run verify:upstream-corpus/u, "corpus compatibility check is missing")
  requireMatch(workflow, /npm run check:managed/u, "managed check is missing")
  requireMatch(workflow, /npm run test\b/u, "root test is missing")
  requireMatch(workflow, /npm run build\b/u, "root build is missing")
  requireMatch(workflow, /npm ci/u, "candidate dependencies must be installed from the lockfile")
  requireMatch(workflow, /managed\/shared\/src\/upstream-observed-receipt\.ts/u, "source-pinned receipt update allowlist is missing")
  requireMatch(workflow, /verify_managed_layer_unchanged/u, "managed layer preservation guard is missing")
  requireMatch(workflow, /\.github\/CODEOWNERS|\.github\/rulesets/u, "protected review policy guard is missing")
  requireMatch(workflow, /verify-license\.mjs/u, "license check is missing")
  requireMatch(workflow, /node --test scripts\/upstream-sync\/\*\.test\.mjs/u, "workflow contract tests are missing")
  requireMatch(workflow, /set -euo pipefail/u, "shell steps must fail closed")
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
