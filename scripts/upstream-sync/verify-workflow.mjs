import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { GATE_COMMANDS, REVIEWED_GATE_MARKER, hasGateCommand, verifyFailClosedGates } from "./verify-shell-gates.mjs"

const ACTION_SHA_PATTERN = /^[0-9a-f]{40}$/u
const SCRIPT_ROOT = path.resolve(process.cwd(), "scripts", "upstream-sync")
const MANAGED_PR_GATE_COMMANDS = Object.freeze([
  'git fetch --no-tags origin "${PR_BASE_SHA}"',
  "npm ci --ignore-scripts",
  "node scripts/upstream-sync/verify-workflow.mjs",
  "node --test scripts/upstream-sync/*.test.mjs",
  "node scripts/upstream-sync/verify-package-scripts.mjs",
  "node scripts/upstream-sync/run-reviewed-gate.mjs UPSTREAM_CORPUS",
  "node scripts/upstream-sync/run-reviewed-gate.mjs MANAGED",
  "node scripts/upstream-sync/run-reviewed-gate.mjs ROOT_TEST",
  "node scripts/upstream-sync/run-reviewed-gate.mjs ROOT_BUILD",
  "node scripts/upstream-sync/run-reviewed-gate.mjs RAW_STATE",
  "node scripts/upstream-sync/verify-license.mjs",
  'git diff --check "${PR_BASE_SHA}...HEAD"',
])
const MANAGED_PR_CANONICAL_RUN = Object.freeze([
  "set -euo pipefail",
  'if [[ ! "${PR_BASE_SHA}" =~ ^[0-9a-f]{40}$ ]]; then',
  '  echo "pull request base SHA is not an exact commit" >&2',
  "  exit 1",
  "fi",
  REVIEWED_GATE_MARKER.BEGIN,
  ...MANAGED_PR_GATE_COMMANDS,
  REVIEWED_GATE_MARKER.END,
].join("\n"))
const CANDIDATE_CANONICAL_SUFFIX = Object.freeze([
  "set -euo pipefail",
  REVIEWED_GATE_MARKER.BEGIN,
  ...GATE_COMMANDS,
  REVIEWED_GATE_MARKER.END,
  'git bundle create "${ARTIFACT_ROOT}/candidate.bundle" "refs/heads/${SYNC_BRANCH}" "^${MANAGED_SHA}"',
  `printf '{"schemaVersion":1,"status":"READY","sourceSha":"%s","managedSha":"%s","syncBranch":"%s","mergeCommitSha":"%s","candidateCommitSha":"%s","candidateTreeSha":"%s","captureBindingSha256":"%s"}\\n' \\`,
  '  "${SOURCE_SHA}" "${MANAGED_SHA}" "${SYNC_BRANCH}" "${MERGE_COMMIT_SHA}" "${CANDIDATE_COMMIT_SHA}" "${CANDIDATE_TREE_SHA}" "${CAPTURE_BINDING_SHA256}" > "${ARTIFACT_ROOT}/candidate-metadata.json"',
  'echo "sync_status=ready" >> "${GITHUB_OUTPUT}"',
].join("\n"))

function requireMatch(value, pattern, detail) {
  if (!pattern.test(value)) throw new Error(detail)
}

function extractJob(workflow, jobName) {
  const jobPattern = new RegExp(`^  ${jobName}:\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:\\n|(?![\\s\\S]))`, "mu")
  const match = workflow.match(jobPattern)
  if (match === null) throw new Error(`${jobName} job is missing`)
  return match[1]
}

function extractStepRunBlock(workflow, stepName) {
  const marker = `      - name: ${stepName}\n`
  const start = workflow.indexOf(marker)
  if (start === -1) throw new Error(`${stepName} step is missing`)
  const next = workflow.indexOf("\n      - name:", start + marker.length)
  const step = workflow.slice(start, next === -1 ? workflow.length : next)
  const match = step.match(/^\s*run:\s*\|\n([\s\S]*)$/mu)
  if (match === null) throw new Error(`${stepName} literal run block is missing`)
  return match[1].split("\n").map((line) => line.startsWith("          ") ? line.slice(10) : line).join("\n")
}

function loadScripts(options = {}) {
  return {
    candidate: options.candidateScript ?? readFileSync(path.join(SCRIPT_ROOT, "candidate.sh"), "utf8"),
    publisher: options.publisherScript ?? readFileSync(path.join(SCRIPT_ROOT, "publisher.sh"), "utf8"),
    runner: options.observationRunner ?? readFileSync(path.join(SCRIPT_ROOT, "observation-runner.mjs"), "utf8"),
    gateDockerfile: options.gateDockerfile ?? readFileSync(path.join(SCRIPT_ROOT, "candidate-gates.Dockerfile"), "utf8"),
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
    if (!hasGateCommand(candidate, command)) throw new Error(`candidate gate is missing from the candidate script: ${command}; failure neutralizer detected`)
  }
  for (const gate of ["git bundle create"]) {
    if (!new RegExp(`^${gate.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:\\s|$)`, "mu").test(candidate)) throw new Error(`candidate gate is missing from the candidate script: ${gate}`)
  }
  verifyFailClosedGates(candidate)
  if (!candidate.endsWith(`${CANDIDATE_CANONICAL_SUFFIX}\n`)) throw new Error("candidate script contains a failure neutralizer: reviewed gates and publication tail are not the exact terminal suffix")
  requireMatch(candidate, /git archive "\$\{CANDIDATE_COMMIT_SHA\}" \| tar -x -C "\$\{UNTRUSTED_WORKTREE\}"[\s\S]*build_untrusted_gate_image[\s\S]*UNTRUSTED_GATE_IMAGE="\$\(<"\$\{UNTRUSTED_GATE_IMAGE_DIGEST_FILE\}"\)"/u, "candidate gates must execute from a content-addressed exported candidate image without repository metadata")
  requireMatch(candidate, /STAGED_TREE_SHA="\$\(git write-tree\)"/u, "candidate must snapshot the staged generated tree")
  requireMatch(candidate, /COMMITTED_TREE_SHA="\$\(git rev-parse HEAD\^\{tree\}\)"[\s\S]*STAGED_TREE_SHA/u, "candidate must bind the committed tree to the staged generated tree")
  requireMatch(candidate, /if \[\[ -n "\$\(git status --porcelain=v1 --untracked-files=all\)" \]\]; then/u, "candidate clean-tree check is missing")
  requireMatch(candidate, /capture-observation\.mjs/u, "candidate must execute the deterministic observation capture")
  for (const [variable, fileName, environmentVariable] of [
    ["CAPTURE_SCRIPT_SHA256", "capture-observation.mjs", "STEEL_CAPTURE_SCRIPT_SHA256"],
    ["CAPTURE_RUNNER_SHA256", "observation-runner.mjs", "STEEL_OBSERVATION_RUNNER_SHA256"],
    ["CAPTURE_OBSERVER_SHA256", "steel-runtime-observer.mjs", "STEEL_RUNTIME_OBSERVER_SHA256"],
    ["CAPTURE_ROUTE_SOURCE_SHA256", "runtime-route-source.mjs", "STEEL_RUNTIME_ROUTE_SOURCE_SHA256"],
    ["CAPTURE_PROBES_SHA256", "runtime-probes.mjs", "STEEL_RUNTIME_PROBES_SHA256"],
    ["CAPTURE_CORPUS_SHA256", "runtime-corpus.mjs", "STEEL_RUNTIME_CORPUS_SHA256"],
    ["CAPTURE_SCHEMA_SHA256", "corpus-schema.mjs", "STEEL_CORPUS_SCHEMA_SHA256"],
  ]) {
    const declaration = `${variable}="$(shasum -a 256 scripts/upstream-sync/${fileName} | awk '{print $1}')"`
    if (!candidate.split("\n").includes(declaration)) throw new Error(`candidate must hash-bind ${fileName} with SHA-256`)
    if (!candidate.includes(`${environmentVariable}="\${${variable}}"`)) throw new Error(`candidate must pass the ${fileName} SHA-256 binding`)
  }
  requireMatch(candidate, /CAPTURE_PLAN_SHA256="\$\(shasum -a 256 "managed\/tests\/upstream\/\$\{LOCK_SHA\}\/route-matrix\.json"[\s\S]*cp "managed\/tests\/upstream\/\$\{LOCK_SHA\}\/route-matrix\.json" "\$\{CAPTURE_PLAN\}"[\s\S]*STEEL_RUNTIME_CAPTURE_PLAN_SHA256="\$\{CAPTURE_PLAN_SHA256\}"/u, "candidate must hash-bind the reviewed runtime capture plan before the source checkout")
  requireMatch(candidate, /CAPTURE_SCRIPT="\$\{ARTIFACT_ROOT\}\/capture-observation\.mjs"[\s\S]*cp scripts\/upstream-sync\/capture-observation\.mjs "\$\{CAPTURE_SCRIPT\}"[\s\S]*cp scripts\/upstream-sync\/observation-runner\.mjs "\$\{CAPTURE_RUNNER\}"[\s\S]*cp scripts\/upstream-sync\/steel-runtime-observer\.mjs "\$\{CAPTURE_OBSERVER\}"[\s\S]*cp scripts\/upstream-sync\/runtime-route-source\.mjs "\$\{CAPTURE_ROUTE_SOURCE\}"[\s\S]*cp scripts\/upstream-sync\/runtime-probes\.mjs "\$\{CAPTURE_PROBES\}"[\s\S]*cp scripts\/upstream-sync\/runtime-corpus\.mjs "\$\{CAPTURE_CORPUS\}"[\s\S]*cp scripts\/upstream-sync\/corpus-schema\.mjs "\$\{CAPTURE_SCHEMA\}"/u, "candidate must preserve the hash-bound capture implementation across the source checkout")
  requireMatch(candidate, /git switch --detach "\$\{SOURCE_SHA\}"[\s\S]*node "\$\{CAPTURE_SCRIPT\}"/u, "candidate must capture against the exact source checkout")
  requireMatch(candidate, /CAPTURE_DOCKERFILE_SHA256="\$\(shasum -a 256 scripts\/upstream-sync\/runtime-capture\.Dockerfile[\s\S]*cp scripts\/upstream-sync\/runtime-capture\.Dockerfile "\$\{CAPTURE_DOCKERFILE\}"[\s\S]*git switch --detach "\$\{SOURCE_SHA\}"[\s\S]*docker build --pull=false --iidfile "\$\{WORKER_IMAGE_DIGEST\}" --file "\$\{CAPTURE_DOCKERFILE\}" \.[\s\S]*STEEL_WORKER_IMAGE_DIGEST_FILE="\$\{WORKER_IMAGE_DIGEST\}"[\s\S]*node "\$\{CAPTURE_SCRIPT\}"/u, "candidate must build and capture the exact source using the hash-bound digest-pinned worker recipe")
  requireMatch(candidate, /if ! STEEL_CAPTURE_SCRIPT_SHA256=[\s\S]*?node "\$\{CAPTURE_SCRIPT\}" \\\n  --repository-root[\s\S]*?; then\n  echo "RUNTIME_CAPTURE_BLOCKED:[^\n]+\n  git switch --detach "\$\{MANAGED_SHA\}"\n  write_blocked_classification\n  exit 0\nfi/u, "capture failure must return to the trusted managed checkout before recording blocked artifacts")
  requireMatch(candidate, /record-blocked-candidate\.mjs/u, "candidate must record complete blocked report artifacts")
  requireMatch(candidate, /\.github\/managed-required-check\.json/u, "candidate fork-owned policy guard must cover the managed required-check binding")
  requireMatch(candidate, /\.github\/bootstrap-capture-contract\.json/u, "candidate fork-owned policy guard must cover the exact bootstrap capture contract")
  requireMatch(candidate, /\.github\/managed-gate-manifest\.json/u, "candidate fork-owned policy guard must cover the reviewed gate manifest")
  requireMatch(candidate, /CAPTURE_BINDING_VERIFIER_SHA256="\$\(shasum -a 256 scripts\/upstream-sync\/verify-capture-binding\.mjs/u, "candidate must hash-bind its capture binding verifier")
  requireMatch(candidate, /CAPTURE_BINDING_SHA256="\$\(shasum -a 256 "\$\{CAPTURE_BINDING\}"/u, "candidate must pin captured bytes before untrusted gates")
  requireMatch(candidate, /pre-untrusted capture binding or verifier changed during candidate gates/u, "candidate must preserve its pre-untrusted capture binding")
  requireMatch(candidate, /captureBindingSha256/u, "candidate metadata must publish the capture binding digest")
  requireMatch(candidate, /RUNTIME_CAPTURE_BLOCKED/u, "candidate must preserve typed runtime blocking")
  if (/STEEL_REVIEWED_CAPTURE_EXECUTABLE|runtime-executable|runtime-args-json/u.test(candidate)) throw new Error("candidate may not accept a caller-selected runtime executable")
  if (/OBSERVED_CORPUS_ROOT|upstream-observations/u.test(candidate)) throw new Error("candidate must not consume an ambiguously named copied corpus")
  requireMatch(candidate, /git add -- managed\/upstream\.lock\.json/u, "generated candidate allowlist must stage the managed corpus")
  if (/git add -- \.github\/workflows\/upstream-sync\.yml/u.test(candidate)) throw new Error("workflow file may not be part of generated candidate changes")
  const guards = [...candidate.matchAll(/^\s*if ! verify_upstream_delta; then\s*$/gmu)].map((match) => match.index)
  if (guards.length < 2) throw new Error("candidate must guard upstream-owned paths before and after merge")
  const mergeIndex = candidate.lastIndexOf("merge-candidate.mjs")
  const installIndex = candidate.lastIndexOf("\nbuild_untrusted_gate_image\n")
  const prepareIndex = candidate.indexOf("prepare-corpus.mjs")
  const commitIndex = candidate.indexOf('git -c core.hooksPath=/dev/null commit -m "ci(managed): record observed upstream corpus ${SOURCE_SHA}"')
  const finalVerifierIndex = candidate.indexOf("node scripts/upstream-sync/verify-candidate-commit.mjs")
  requireMatch(candidate, /git diff --check "\$\{MANAGED_SHA\}\.\.\.HEAD"/u, "candidate must check the full managed-to-candidate range")
  const lastGateIndex = Math.max(...GATE_COMMANDS.map((gate) => candidate.lastIndexOf(gate)))
  if (mergeIndex === -1 || installIndex === -1 || guards[0] > mergeIndex || guards[1] > installIndex) throw new Error("candidate fork-owned-path guard must run before candidate install")
  if (prepareIndex === -1 || commitIndex === -1 || prepareIndex > commitIndex) throw new Error("generated candidate changes must be prepared before commit")
  if (finalVerifierIndex < lastGateIndex) throw new Error("candidate commit verifier must run after all executable gates")
}

function verifyPublisherScript(publisher) {
  requireMatch(publisher, /^#!\/usr\/bin\/env bash\nset -euo pipefail/u, "publisher script must fail closed")
  for (const pattern of [
    /git bundle verify/u,
    /verify-candidate-commit\.mjs/u,
    /verify-capture-binding\.mjs/u,
    /verify-repository-rules\.mjs --repository/u,
    /git ls-remote --symref .*UPSTREAM_URL.* HEAD/u,
    /git check-ref-format "refs\/heads\/\$\{UPSTREAM_DEFAULT_BRANCH\}"/u,
    /push origin "\$\{SOURCE_SHA\}:refs\/heads\/\$\{MIRROR_BRANCH\}"/u,
    /gh pr (?:create|edit)/u,
    /managed pull request could not be read back/u,
  ]) requireMatch(publisher, pattern, `publisher script contract is missing: ${pattern}`)
  requireMatch(publisher, /META_BRANCH.*\^upstream-sync\/\[0-9a-f\]\{12\}\$/u, "publisher must validate the exact upstream SHA12 candidate branch")
  if (/RECOVERY_BRANCH/u.test(publisher)) throw new Error("publisher may not create noncanonical recovery branches")
  requireMatch(publisher, /required checks and immutable upstream-sync refs/u, "publisher PR evidence must describe enforced repository rules")
  for (const field of ["CLASSIFICATION_CATEGORIES", "BLOCKED_REASONS", "UPSTREAM_COMMITS", "RELEASE_NOTES", "MIGRATION_NOTES", "GENERATED_ARTIFACT_STATUS", "RUN_URL", "CANDIDATE_EVIDENCE_ARTIFACT_NAME", "CAPTURE_ARTIFACT_NAME", "CAPTURE_ARTIFACT_PATH"]) {
    requireMatch(publisher, new RegExp(`^${field}=`, "mu"), `publisher must precompute validated PR evidence: ${field}`)
  }
  if (/\\\$\(jq/u.test(publisher)) throw new Error("publisher PR body may not contain literal jq substitutions")
  requireMatch(publisher, /^META_CAPTURE_BINDING_SHA256="\$\(jq -r '\.captureBindingSha256 \/\/ empty' sync-artifact\/candidate-metadata\.json\)"$/mu, "publisher must bind downloaded capture metadata before publication")
  requireMatch(publisher, /EXPECTED_CAPTURE_BINDING_SHA256[\s\S]*shasum -a 256 trusted-capture\/capture-binding\.json/u, "publisher must bind the separately downloaded immutable pre-gate capture before publication")
  requireMatch(publisher, /verify-existing-candidate\.mjs[\s\S]*--binding-output "\$\{EXISTING_CAPTURE_BINDING\}"[\s\S]*--classification-output "\$\{CLASSIFICATION_PATH\}"[\s\S]*REUSED_VERIFIED_IMMUTABLE_CANDIDATE/u, "publisher must independently reverify and reuse a same-source immutable candidate")
  for (const pattern of [
    /^REQUIRED_CHECK_CONTEXT="\$\(jq -er '\.context \| strings \| select\(length > 0\)' \.github\/managed-required-check\.json\)"$/mu,
    /^REQUIRED_CHECK_REGISTRATION_ATTEMPTS=30$/mu,
    /for \(\(attempt = 1; attempt <= REQUIRED_CHECK_REGISTRATION_ATTEMPTS; attempt \+= 1\)\); do[\s\S]*gh pr checks "\$\{pr_number\}" --repo "\$\{GITHUB_REPOSITORY\}" --json workflow,name --jq '\.\[\] \| "\\\(\.workflow\) \/ \\\(\.name\)"'[\s\S]*grep -Fxq -- "\$\{REQUIRED_CHECK_CONTEXT\}"[\s\S]*return 1/u,
    /wait_for_required_check "\$\{PR_NUMBER\}" \|\| \{[^\n]+exit 1; \}/u,
    /gh pr checks "\$\{PR_NUMBER\}" --repo "\$\{GITHUB_REPOSITORY\}" --required --watch --fail-fast/u,
  ]) requireMatch(publisher, pattern, "publisher required check registration contract is missing")
  if (/gh\s+pr\s+merge\b/u.test(publisher) || /enable-auto-merge/u.test(publisher) || /git\s+rebase\b/u.test(publisher)) throw new Error("publisher may not merge, rebase, or auto-merge")
  if (/git\s+push[^\n]*refs\/heads\/managed\b/u.test(publisher)) throw new Error("publisher may not push protected managed")
}

function verifyObservationRunner(runner) {
  requireMatch(runner, /export async function runRepositoryObservation/u, "observation runner entrypoint is missing")
  requireMatch(runner, /RUNTIME_CAPTURE_BLOCKED/u, "observation runner must block unavailable runtime capture")
  requireMatch(runner, /rev-parse.*HEAD/u, "observation runner must bind the checked-out HEAD")
  requireMatch(runner, /STEEL_RUNTIME_OBSERVER_SHA256/u, "observation runner must verify the fixed observer hash")
  requireMatch(runner, /STEEL_CORPUS_SCHEMA_SHA256/u, "observation runner must verify the strict corpus schema hash")
  if (/managed\/tests\/upstream|record\.health|record\.websocket/u.test(runner)) throw new Error("observation runner may not fabricate or copy protocol corpus artifacts")
}

function verifyBootstrapCaptureScript(script, contractText) {
  const contract = JSON.parse(contractText)
  const contractKeys = Object.keys(contract).sort()
  if (JSON.stringify(contractKeys) !== JSON.stringify(["schemaVersion", "scriptPath", "sha256"]) || contract.schemaVersion !== 1 || contract.scriptPath !== "scripts/upstream-sync/bootstrap-pr-capture.sh" || !/^[0-9a-f]{64}$/u.test(contract.sha256)) throw new Error("bootstrap capture contract manifest is invalid")
  if (createHash("sha256").update(script).digest("hex") !== contract.sha256) throw new Error("bootstrap capture script differs from its exact reviewed contract")
  requireMatch(script, /^#!\/usr\/bin\/env bash\nset -euo pipefail/u, "bootstrap capture script must fail closed")
  requireMatch(script, /scripts\/upstream-sync\/\*\)[\s\S]*return 0/u, "bootstrap capture-sensitive paths must include the capture script itself")
  requireMatch(script, /printf 'capture_required=false\\n' >> "\$\{GITHUB_OUTPUT\}"[\s\S]*if ! capture_is_required; then[\s\S]*exit 0/u, "bootstrap capture may skip only when no reviewed capture-sensitive path changed")
  requireMatch(script, /UPSTREAM_URL="https:\/\/github\.com\/steel-dev\/steel-browser\.git"[\s\S]*git ls-remote "\$\{UPSTREAM_URL\}" "refs\/heads\/\$\{UPSTREAM_DEFAULT_BRANCH\}"[\s\S]*git fetch --no-tags bootstrap-upstream "\$\{SOURCE_SHA\}"/u, "bootstrap capture must resolve and fetch the exact public upstream SHA")
  requireMatch(script, /git worktree add --detach "\$\{SOURCE_WORKTREE\}" "\$\{SOURCE_SHA\}"[\s\S]*docker build --pull=false --iidfile "\$\{WORKER_IMAGE_DIGEST_FILE\}" --file "\$\{PWD\}\/scripts\/upstream-sync\/runtime-capture\.Dockerfile" "\$\{SOURCE_WORKTREE\}"/u, "bootstrap capture must build the exact source with the pinned runtime recipe")
  for (const variable of ["STEEL_CAPTURE_SCRIPT_SHA256", "STEEL_OBSERVATION_RUNNER_SHA256", "STEEL_RUNTIME_OBSERVER_SHA256", "STEEL_RUNTIME_ROUTE_SOURCE_SHA256", "STEEL_RUNTIME_PROBES_SHA256", "STEEL_RUNTIME_CORPUS_SHA256", "STEEL_CORPUS_SCHEMA_SHA256", "STEEL_RUNTIME_CAPTURE_PLAN_SHA256"]) {
    requireMatch(script, new RegExp(`${variable}="\\$\\(shasum -a 256`, "u"), `bootstrap capture must hash-bind ${variable}`)
  }
  requireMatch(script, /node scripts\/upstream-sync\/capture-observation\.mjs[\s\S]*--repository-root "\$\{SOURCE_WORKTREE\}"[\s\S]*node scripts\/upstream-sync\/verify-runtime-capture\.mjs[\s\S]*--repository-root "\$\{SOURCE_WORKTREE\}"/u, "bootstrap capture must run and canonically verify the exact source observation")
  const verifierIndex = script.indexOf("node scripts/upstream-sync/verify-runtime-capture.mjs")
  const successOutputIndex = script.indexOf("printf 'capture_required=true")
  if (verifierIndex === -1 || successOutputIndex < verifierIndex) throw new Error("bootstrap capture may report success only after canonical runtime verification")
  requireMatch(script, /ARTIFACT_NAME="steel-bootstrap-capture-\$\{SOURCE_SHA\}-\$\{CAPTURE_BINDING_SHA256\}"[\s\S]*bootstrap-capture-metadata\.json[\s\S]*GITHUB_STEP_SUMMARY/u, "bootstrap capture must surface immutable artifact coordinates")
  if (/\|\|\s*true|STEEL_REVIEWED_CAPTURE_EXECUTABLE|runtime-executable|runtime-args-json/u.test(script)) throw new Error("bootstrap capture contains a failure neutralizer or caller-selected runtime")
}

function verifyBlockedReport(workflow) {
  const blocked = extractJob(workflow, "report-blocked")
  const labelCommand = 'gh label create "status: blocked" --repo "${GITHUB_REPOSITORY}" --color "B60205" --description "Upstream sync requires human review" --force'
  if (!blocked.split("\n").some((line) => line.trim() === labelCommand)) throw new Error("blocked report must idempotently ensure its issue label")
  const labelIndex = blocked.indexOf(labelCommand)
  const issueListIndex = blocked.indexOf("gh issue list")
  const issueCreateIndex = blocked.indexOf("gh issue create")
  if (labelIndex === -1 || issueListIndex === -1 || issueCreateIndex === -1 || labelIndex > issueListIndex || labelIndex > issueCreateIndex) {
    throw new Error("blocked report must ensure its issue label before issue read/write operations")
  }
  requireMatch(blocked, /CATEGORIES="\$\(jq -ce '[^']*categories[^']*' sync-artifact\/classification\.json\)"/u, "blocked report must render compact validated categories")
  requireMatch(blocked, /BLOCKED_REASONS="\$\(jq -ce '[^']*blockedReasons[^']*' sync-artifact\/classification\.json\)"/u, "blocked report must render compact validated reasons")
  requireMatch(blocked, /UPSTREAM_COMMITS="\$\(jq -ce '[^']*upstreamTraceability\.commits[^']*' sync-artifact\/classification\.json\)"/u, "blocked report must render source-range commits")
  requireMatch(blocked, /RELEASE_NOTES="\$\(jq -ce '[^']*upstreamTraceability\.releaseNotes[^']*' sync-artifact\/classification\.json\)"/u, "blocked report must render release-note evidence")
  requireMatch(blocked, /MIGRATION_NOTES="\$\(jq -ce '[^']*upstreamTraceability\.migrationNotes[^']*' sync-artifact\/classification\.json\)"/u, "blocked report must render migration-note evidence")
  requireMatch(blocked, /RUN_URL="\$\{GITHUB_SERVER_URL\}\/\$\{GITHUB_REPOSITORY\}\/actions\/runs\/\$\{GITHUB_RUN_ID\}"[\s\S]*BLOCKED_ARTIFACT_NAME="steel-upstream-sync-\$\{SOURCE_SHA\}"[\s\S]*classification\.json[\s\S]*candidate-metadata\.json/u, "blocked report must surface its exact evidence artifact and paths")
  if (/\\\$\(jq/u.test(blocked)) throw new Error("blocked report body may not contain literal jq substitutions")
}

export function verifyManagedPrGateText(workflow, options = {}) {
  const bootstrapScript = options.bootstrapScript ?? readFileSync(path.join(SCRIPT_ROOT, "bootstrap-pr-capture.sh"), "utf8")
  const bootstrapContract = options.bootstrapContract ?? readFileSync(path.resolve(process.cwd(), ".github", "bootstrap-capture-contract.json"), "utf8")
  verifyActions(workflow)
  requireMatch(workflow, /^on:\n\s+pull_request:\n\s+branches:\n\s+- managed\s*$/mu, "managed PR gate must target pull requests to managed")
  requireMatch(workflow, /node-version:\s*22\.23\.1/u, "managed PR gate must use Node 22.23.1")
  requireMatch(workflow, /PR_BASE_SHA:\s*\$\{\{ github\.event\.pull_request\.base\.sha \}\}/u, "managed PR gate must bind the pull request base SHA")
  requireMatch(workflow, /if \[\[ ! "\$\{PR_BASE_SHA\}" =~ \^\[0-9a-f\]\{40\}\$ \]\]; then/u, "managed PR gate must validate the base SHA")
  requireMatch(workflow, /git fetch --no-tags origin "\$\{PR_BASE_SHA\}"/u, "managed PR gate must fetch the exact base SHA")
  if (/^\s*git diff --check\s*$/mu.test(workflow)) throw new Error("managed PR gate may not inspect an empty worktree diff")
  requireMatch(workflow, /git diff --check "\$\{PR_BASE_SHA\}\.\.\.HEAD"/u, "managed PR gate must check the pull request range")
  const runBlock = extractStepRunBlock(workflow, "Run managed pull request gates")
  for (const command of MANAGED_PR_GATE_COMMANDS) {
    if (!hasGateCommand(runBlock, command)) throw new Error(`managed PR gate is missing or neutralized: ${command}; failure neutralizer detected`)
  }
  if (runBlock.trimEnd() !== MANAGED_PR_CANONICAL_RUN) throw new Error("managed PR gate contains a failure neutralizer: run block is not the exact canonical manifest")
  verifyFailClosedGates(runBlock, MANAGED_PR_GATE_COMMANDS)
  requireMatch(workflow, /name: Capture exact upstream runtime for bootstrap review[\s\S]*id: bootstrap_capture[\s\S]*PR_BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}[\s\S]*run: bash scripts\/upstream-sync\/bootstrap-pr-capture\.sh/u, "managed PR gate bootstrap capture step is missing")
  requireMatch(workflow, /name: Upload immutable bootstrap runtime capture[\s\S]*if: steps\.bootstrap_capture\.outputs\.capture_required == 'true'[\s\S]*actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02[\s\S]*name: steel-bootstrap-capture-\$\{\{ steps\.bootstrap_capture\.outputs\.source_sha \}\}-\$\{\{ steps\.bootstrap_capture\.outputs\.capture_binding_sha256 \}\}[\s\S]*path: \$\{\{ runner\.temp \}\}\/steel-managed-pr-capture/u, "managed PR gate immutable bootstrap capture upload is missing")
  requireMatch(workflow, /ARTIFACT_ARCHIVE_DIGEST: \$\{\{ steps\.bootstrap_upload\.outputs\.artifact-digest \}\}[\s\S]*GITHUB_STEP_SUMMARY/u, "managed PR gate must surface the uploaded capture digest")
  verifyBootstrapCaptureScript(bootstrapScript, bootstrapContract)
  for (const gate of ["node scripts/upstream-sync/verify-workflow.mjs", "node --test scripts/upstream-sync/*.test.mjs", "node scripts/upstream-sync/verify-package-scripts.mjs", "node scripts/upstream-sync/run-reviewed-gate.mjs UPSTREAM_CORPUS", "node scripts/upstream-sync/run-reviewed-gate.mjs MANAGED", "node scripts/upstream-sync/run-reviewed-gate.mjs ROOT_TEST", "node scripts/upstream-sync/run-reviewed-gate.mjs ROOT_BUILD", "node scripts/upstream-sync/run-reviewed-gate.mjs RAW_STATE", "node scripts/upstream-sync/verify-license.mjs"]) {
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
  requireMatch(candidate, /run:\s+bash scripts\/upstream-sync\/candidate\.sh capture/u, "candidate must invoke the reviewed capture phase")
  requireMatch(candidate, /run:\s+bash scripts\/upstream-sync\/candidate\.sh generate/u, "candidate must invoke the reviewed generation phase")
  requireMatch(publisher, /run:\s+bash scripts\/upstream-sync\/publisher\.sh/u, "publisher must invoke the reviewed publisher script")
  verifyCandidateScript(scripts.candidate)
  verifyPublisherScript(scripts.publisher)
  verifyObservationRunner(scripts.runner)
  requireMatch(scripts.gateDockerfile, /^FROM docker\.io\/library\/node:22\.23\.1-bookworm@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37$/mu, "candidate untrusted runtime must be digest pinned")
  requireMatch(scripts.gateDockerfile, /^RUN npm ci --ignore-scripts --no-audit --no-fund/mu, "candidate gate image dependency hydration must disable lifecycle scripts")
  verifyBlockedReport(workflow)
  requireMatch(workflow, /^on:\n(?=[\s\S]*^  schedule:\n)(?=[\s\S]*^  workflow_dispatch:\s*$)/mu, "workflow must expose weekly schedule and workflow_dispatch")
  requireMatch(workflow, /^\s*-\s*cron:\s*["']17 17 \* \* 6["']\s*$/mu, "workflow schedule must be Sunday 02:17 KST (Saturday 17:17 UTC)")
  requireMatch(workflow, /^concurrency:\n\s+group:\s+steel-managed-upstream-sync\n\s+cancel-in-progress:\s+false\s*$/mu, "workflow concurrency must serialize runs")
  requireMatch(workflow, /REVIEW_ACKNOWLEDGEMENT_ROOT/u, "review acknowledgement root is missing")
  requireMatch(workflow, /actions\/upload-artifact@/u, "candidate evidence upload is missing")
  requireMatch(workflow, /actions\/download-artifact@/u, "publisher evidence download is missing")
  const captureRunIndex = candidate.indexOf("run: bash scripts/upstream-sync/candidate.sh capture")
  const trustedInstallIndex = candidate.indexOf("name: Install trusted managed verifier dependencies")
  const contractVerificationIndex = candidate.indexOf("name: Verify sync automation contract")
  const captureUploadIndex = candidate.indexOf("name: Upload immutable pre-gate runtime capture")
  const captureRemoveIndex = candidate.indexOf("name: Remove mutable pre-upload capture copy")
  const captureDownloadIndex = candidate.indexOf("name: Download immutable pre-gate runtime capture")
  const generateRunIndex = candidate.indexOf("run: bash scripts/upstream-sync/candidate.sh generate")
  if ([trustedInstallIndex, contractVerificationIndex, captureRunIndex, captureUploadIndex, captureRemoveIndex, captureDownloadIndex, generateRunIndex].some((index) => index === -1) || !(trustedInstallIndex < contractVerificationIndex && contractVerificationIndex < captureRunIndex && captureRunIndex < captureUploadIndex && captureUploadIndex < captureRemoveIndex && captureRemoveIndex < captureDownloadIndex && captureDownloadIndex < generateRunIndex)) {
    throw new Error("immutable pre-gate capture must be uploaded and independently downloaded before candidate generation")
  }
  requireMatch(candidate, /name:\s+Install trusted managed verifier dependencies[\s\S]*run:\s+npm ci --ignore-scripts/u, "trusted managed verifier dependencies must be installed without lifecycle scripts before contract tests")
  requireMatch(candidate, /name:\s+steel-upstream-capture-\$\{\{ steps\.capture\.outputs\.source_sha \}\}-\$\{\{ steps\.capture\.outputs\.capture_binding_sha256 \}\}/u, "immutable capture artifact name must bind source and capture digest")
  requireMatch(publisher, /name:\s+steel-upstream-capture-\$\{\{ needs\.candidate\.outputs\.source_sha \}\}-\$\{\{ needs\.candidate\.outputs\.capture_binding_sha256 \}\}[\s\S]*path:\s+trusted-capture/u, "publisher must separately download the immutable pre-gate capture")
  if (/(?:READ_TOKEN|PUBLISH_TOKEN|GH_TOKEN|GITHUB_TOKEN):/u.test(candidate)) throw new Error("candidate job may not receive token environment variables")
  requireMatch(workflow, /if: needs\.candidate\.outputs\.sync_status == 'blocked'/u, "blocked classification reporting is missing")
  requireMatch(workflow, /UPSTREAM_URL:\s*https:\/\/github\.com\/steel-dev\/steel-browser\.git/u, "canonical upstream URL is missing")
  requireMatch(scripts.candidate, /git fetch --no-tags upstream "\$\{UPSTREAM_DEFAULT_BRANCH\}"/u, "upstream default branch must be fetched without tags")
  requireMatch(scripts.candidate, /merge-candidate\.mjs[\s\S]*MERGE_CONFLICT/u, "candidate must use the reviewed typed merge-conflict path")
  requireMatch(scripts.candidate, /managed\/shared\/src\/upstream-observed-receipt\.ts/u, "source-pinned receipt update allowlist is missing")
  requireMatch(scripts.candidate, /--observed-corpus-directory/u, "corpus preparation must use captured output")
  requireMatch(scripts.candidate, /classify-upstream\.mjs/u, "upstream classification is missing")
  if (/STEEL_REVIEWED_CAPTURE_EXECUTABLE|STEEL_REVIEWED_CAPTURE_ARGS_JSON|runtime-executable|runtime-args-json/u.test(`${workflow}\n${scripts.candidate}`)) throw new Error("production capture may not accept caller-selected runtime execution")
  for (const gate of ["UPSTREAM_CORPUS", "MANAGED", "ROOT_TEST", "ROOT_BUILD", "RAW_STATE"]) {
    if (!scripts.publisher.includes(`direct reviewed \\\`${gate}\\\``)) throw new Error(`direct reviewed ${gate} gate evidence is missing`)
  }
  requireMatch(scripts.gateDockerfile, /npm ci --ignore-scripts/u, "candidate dependencies must be installed from the lockfile without lifecycle scripts")
  if (/(?:git\s+rebase|gh\s+pr\s+merge|enable-auto-merge)/u.test(`${workflow}\n${scripts.candidate}\n${scripts.publisher}`)) throw new Error("force merge/rebase automation is forbidden")
  if (/git\s+fetch[^\n]*\|\|\s*true/u.test(`${scripts.candidate}\n${scripts.publisher}`)) throw new Error("remote fetch failures may not be treated as missing refs")
  return { status: "VERIFIED" }
}

async function main() {
  const workflowPath = path.resolve(process.cwd(), ".github", "workflows", "upstream-sync.yml")
  const managedPrWorkflowPath = path.resolve(process.cwd(), ".github", "workflows", "managed-pr-gates.yml")
  const workflow = await readFile(workflowPath, "utf8")
  const managedPrWorkflow = await readFile(managedPrWorkflowPath, "utf8")
  console.log(`UPSTREAM_SYNC_WORKFLOW_VERIFIED ${JSON.stringify({ upstreamSync: verifyWorkflowText(workflow), managedPullRequest: verifyManagedPrGateText(managedPrWorkflow) })}`)
}

if (process.argv[1] !== undefined && path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "unknown workflow verification failure")
    process.exitCode = 1
  })
}
