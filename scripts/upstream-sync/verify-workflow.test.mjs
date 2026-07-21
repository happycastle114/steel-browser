import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
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
const bootstrapPath = path.resolve("scripts/upstream-sync/bootstrap-pr-capture.sh")
const bootstrapContractPath = path.resolve(".github/bootstrap-capture-contract.json")
const candidateTestGate = "run_untrusted node scripts/upstream-sync/run-reviewed-gate.mjs ROOT_TEST"

async function inputs() {
  return {
    workflow: await readFile(workflowPath, "utf8"),
    managedPrWorkflow: await readFile(managedPrWorkflowPath, "utf8"),
    candidateScript: await readFile(candidatePath, "utf8"),
    publisherScript: await readFile(publisherPath, "utf8"),
    bootstrapScript: await readFile(bootstrapPath, "utf8"),
    bootstrapContract: await readFile(bootstrapContractPath, "utf8"),
  }
}

function blockedReportRunBlock(workflow) {
  const marker = "      - name: Report one deduplicated blocked review item\n"
  const start = workflow.indexOf(marker)
  assert.notEqual(start, -1)
  const step = workflow.slice(start)
  const match = step.match(/^\s*run:\s*\|\n([\s\S]*)$/mu)
  assert.notEqual(match, null)
  return match[1].split("\n").map((line) => line.startsWith("          ") ? line.slice(10) : line).join("\n")
}

function publisherPrBodyBlock(publisher) {
  const start = publisher.indexOf('PR_TITLE="chore(upstream): sync ${SOURCE_SHA}"')
  const end = publisher.indexOf('PR_NUMBER="$(gh pr list', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  return `${publisher.slice(start, end)}\nprintf '%s' "\${PR_BODY}" > "\${BODY_CAPTURE_PATH}"\n`
}

function publisherCheckRegistrationBlock(publisher) {
  const start = publisher.indexOf("REQUIRED_CHECK_CONTEXT=")
  const end = publisher.indexOf("META_SOURCE_SHA=", start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  return `${publisher.slice(start, end)}\nwait_for_required_check "42"\n`
}

function bootstrapDetectionBlock(script) {
  const start = script.indexOf("capture_is_required()")
  const end = script.indexOf('\n[[ "${PR_BASE_SHA}"', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  return script.slice(start, end)
}

test("managed PR gate binds whitespace checks to the pull request range", async () => {
  const { managedPrWorkflow } = await inputs()
  assert.deepEqual(verifyManagedPrGateText(managedPrWorkflow), { status: "VERIFIED" })
})

test("managed PR gate conditionally captures exact Linux browser and CDP evidence", async () => {
  const { managedPrWorkflow } = await inputs()
  assert.match(managedPrWorkflow, /name: Capture exact upstream runtime for bootstrap review/u)
  assert.match(managedPrWorkflow, /run: bash scripts\/upstream-sync\/bootstrap-pr-capture\.sh/u)
  assert.match(managedPrWorkflow, /name: steel-bootstrap-capture-\$\{\{ steps\.bootstrap_capture\.outputs\.source_sha \}\}-\$\{\{ steps\.bootstrap_capture\.outputs\.capture_binding_sha256 \}\}/u)
  assert.match(managedPrWorkflow, /path: \$\{\{ runner\.temp \}\}\/steel-managed-pr-capture/u)
  assert.match(managedPrWorkflow, /if: steps\.bootstrap_capture\.outputs\.capture_required == 'true'/u)
})

test("managed PR gate rejects a neutralized or incomplete bootstrap capture script", async () => {
  const { managedPrWorkflow, bootstrapScript } = await inputs()
  for (const mutation of [
    'echo "capture_required=false" >> "${GITHUB_OUTPUT}"\nexit 0\n',
    bootstrapScript.replace("set -euo pipefail\n", 'set -euo pipefail\nprintf \'capture_required=false\\n\' >> "${GITHUB_OUTPUT}"; exit 0\n'),
    bootstrapScript.replace("scripts/upstream-sync/*)", "scripts/other/*)"),
    bootstrapScript.replace("node scripts/upstream-sync/verify-runtime-capture.mjs", "true"),
    bootstrapScript.replace("printf 'capture_required=true", "printf 'capture_required=false"),
  ]) assert.throws(() => verifyManagedPrGateText(managedPrWorkflow, { bootstrapScript: mutation }), /bootstrap capture/)
})

test("bootstrap capture detection executes for its own path but skips unrelated changes", async (t) => {
  const { bootstrapScript } = await inputs()
  const root = await mkdtemp(path.join(os.tmpdir(), "steel-bootstrap-detection-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await execFileAsync("git", ["init", "-q"], { cwd: root })
  await execFileAsync("git", ["config", "user.name", "bootstrap-fixture"], { cwd: root })
  await execFileAsync("git", ["config", "user.email", "bootstrap@example.invalid"], { cwd: root })
  await writeFile(path.join(root, "README.md"), "base\n")
  await execFileAsync("git", ["add", "README.md"], { cwd: root })
  await execFileAsync("git", ["commit", "-qm", "base"], { cwd: root })
  const baseSha = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim()
  const detection = `${bootstrapDetectionBlock(bootstrapScript)}\nif capture_is_required; then echo REQUIRED; else echo SKIPPED; fi\n`
  await writeFile(path.join(root, "README.md"), "unrelated\n")
  await execFileAsync("git", ["add", "README.md"], { cwd: root })
  await execFileAsync("git", ["commit", "-qm", "unrelated"], { cwd: root })
  assert.equal((await execFileAsync("bash", ["-c", detection], { cwd: root, env: { ...process.env, PR_BASE_SHA: baseSha } })).stdout.trim(), "SKIPPED")
  await mkdir(path.join(root, "scripts", "upstream-sync"), { recursive: true })
  await writeFile(path.join(root, "scripts", "upstream-sync", "bootstrap-pr-capture.sh"), "changed\n")
  await execFileAsync("git", ["add", "scripts/upstream-sync/bootstrap-pr-capture.sh"], { cwd: root })
  await execFileAsync("git", ["commit", "-qm", "capture-sensitive"], { cwd: root })
  assert.equal((await execFileAsync("bash", ["-c", detection], { cwd: root, env: { ...process.env, PR_BASE_SHA: baseSha } })).stdout.trim(), "REQUIRED")
})

test("managed PR gate rejects a tautological empty-worktree diff check", async () => {
  const { managedPrWorkflow } = await inputs()
  assert.throws(() => verifyManagedPrGateText(managedPrWorkflow.replace('git diff --check "${PR_BASE_SHA}...HEAD"', "git diff --check")), /empty worktree diff/)
})

test("managed PR gate requires the exact root test command", async () => {
  const { managedPrWorkflow } = await inputs()
  assert.throws(() => verifyManagedPrGateText(managedPrWorkflow.replace(/^\s+node scripts\/upstream-sync\/run-reviewed-gate\.mjs ROOT_TEST$/mu, "          node scripts/upstream-sync/run-reviewed-gate.mjs MANAGED")), /missing or neutralized: node scripts\/upstream-sync\/run-reviewed-gate\.mjs ROOT_TEST/)
})

test("managed PR gate rejects semantic shell neutralizers for required commands", async () => {
  const { managedPrWorkflow } = await inputs()
  const gate = "node scripts/upstream-sync/run-reviewed-gate.mjs ROOT_TEST"
  for (const neutralizer of [
    `${gate} || true`,
    `if\n            ${gate}\n          then\n            echo ignored\n          fi`,
    `${gate} || false &`,
    `(${gate})`,
    `{ ${gate}; }`,
  ]) {
    assert.throws(() => verifyManagedPrGateText(managedPrWorkflow.replace(gate, neutralizer)), /failure neutralizer/, neutralizer)
  }
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

test("workflow verifier rejects missing hash bindings for copied capture components", async () => {
  const { workflow, candidateScript } = await inputs()
  for (const [variable, fileName, environmentVariable] of [
    ["CAPTURE_SCRIPT_SHA256", "capture-observation.mjs", "STEEL_CAPTURE_SCRIPT_SHA256"],
    ["CAPTURE_RUNNER_SHA256", "observation-runner.mjs", "STEEL_OBSERVATION_RUNNER_SHA256"],
    ["CAPTURE_OBSERVER_SHA256", "steel-runtime-observer.mjs", "STEEL_RUNTIME_OBSERVER_SHA256"],
    ["CAPTURE_ROUTE_SOURCE_SHA256", "runtime-route-source.mjs", "STEEL_RUNTIME_ROUTE_SOURCE_SHA256"],
    ["CAPTURE_PROBES_SHA256", "runtime-probes.mjs", "STEEL_RUNTIME_PROBES_SHA256"],
    ["CAPTURE_CORPUS_SHA256", "runtime-corpus.mjs", "STEEL_RUNTIME_CORPUS_SHA256"],
    ["CAPTURE_SCHEMA_SHA256", "corpus-schema.mjs", "STEEL_CORPUS_SCHEMA_SHA256"],
  ]) {
    const declaration = `${variable}="$(shasum -a 256 scripts/upstream-sync/${fileName} | awk '{print $1}')"\n`
    assert.throws(() => verifyWorkflowText(workflow, { candidateScript: candidateScript.replace(declaration, "") }), /hash-bind/, fileName)
    assert.throws(() => verifyWorkflowText(workflow, { candidateScript: candidateScript.replace(environmentVariable, `${environmentVariable}_REMOVED`) }), /SHA-256 binding/, environmentVariable)
  }
})

test("workflow verifier rejects blocked classification from the untrusted source checkout", async () => {
  const { workflow, candidateScript } = await inputs()
  const trustedReturn = '  git switch --detach "${MANAGED_SHA}"\n  write_blocked_classification\n  exit 0\nfi\nCAPTURE_BINDING='
  const mutation = candidateScript.replace(trustedReturn, '  write_blocked_classification\n  exit 0\nfi\nCAPTURE_BINDING=')
  assert.notEqual(mutation, candidateScript)
  assert.throws(() => verifyWorkflowText(workflow, { candidateScript: mutation }), /trusted managed checkout/)
})

test("workflow verifier rejects removal of capture binding across the publisher boundary", async () => {
  const { workflow, candidateScript, publisherScript } = await inputs()
  assert.throws(() => verifyWorkflowText(workflow, { candidateScript: candidateScript.replace(/^CAPTURE_BINDING_SHA256=.*\n/mu, "") }), /pin captured bytes/)
  assert.throws(() => verifyWorkflowText(workflow, { publisherScript: publisherScript.replace(/^META_CAPTURE_BINDING_SHA256=.*\n/mu, "") }), /bind downloaded capture metadata/)
})

test("workflow verifier binds immutable capture ordering and token-free candidate execution", async () => {
  const { workflow } = await inputs()
  assert.throws(() => verifyWorkflowText(workflow.replace("Upload immutable pre-gate runtime capture", "Upload runtime capture")), /immutable pre-gate capture/)
  assert.throws(() => verifyWorkflowText(workflow.replace("Download immutable pre-gate runtime capture", "Download runtime capture")), /immutable pre-gate capture|separately download/)
  assert.throws(() => verifyWorkflowText(workflow.replace("      contents: read", "      contents: read\n      GH_TOKEN: injected")), /token environment/)
})

test("workflow verifier requires behavior-level immutable candidate reuse", async () => {
  const { workflow, publisherScript } = await inputs()
  for (const mutation of [
    publisherScript.replace("verify-existing-candidate.mjs", "verify-candidate-commit.mjs"),
    publisherScript.replace('--binding-output "${EXISTING_CAPTURE_BINDING}"', ""),
    publisherScript.replace("REUSED_VERIFIED_IMMUTABLE_CANDIDATE", "REGENERATED_CANDIDATE"),
  ]) assert.throws(() => verifyWorkflowText(workflow, { publisherScript: mutation }), /independently reverify and reuse/)
})

test("workflow verifier requires bounded exact-context check registration before watch", async () => {
  const { workflow, publisherScript } = await inputs()
  for (const mutation of [
    publisherScript.replace(".github/managed-required-check.json)", ".github/any-check.json)"),
    publisherScript.replace("REQUIRED_CHECK_REGISTRATION_ATTEMPTS=30", "REQUIRED_CHECK_REGISTRATION_ATTEMPTS=0"),
    publisherScript.replace('gh pr checks "${PR_NUMBER}" --repo "${GITHUB_REPOSITORY}" --required --watch --fail-fast', 'gh pr checks "${PR_NUMBER}" --repo "${GITHUB_REPOSITORY}" --watch --fail-fast'),
  ]) assert.throws(() => verifyWorkflowText(workflow, { publisherScript: mutation }), /required check registration/)
})

test("publisher composes the required context from the real gh workflow and name fields", async (t) => {
  const { publisherScript } = await inputs()
  const root = await mkdtemp(path.join(os.tmpdir(), "steel-required-check-"))
  const bin = path.join(root, "bin")
  const githubDirectory = path.join(root, ".github")
  const countPath = path.join(root, "gh-count")
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(bin, { recursive: true })
  await mkdir(githubDirectory, { recursive: true })
  await writeFile(path.join(githubDirectory, "managed-required-check.json"), `${JSON.stringify({ context: "Managed pull request gates / gates" })}\n`)
  const fakeGh = path.join(bin, "gh")
  await writeFile(fakeGh, `#!/usr/bin/env bash\nset -euo pipefail\nprintf 'x' >> "\${GH_COUNT_PATH}"\nif [[ "$*" != *"--json workflow,name"* || "$*" != *'--jq .[] | "\\(.workflow) / \\(.name)"'* ]]; then\n  exit 65\nfi\nif [[ "$(wc -c < "\${GH_COUNT_PATH}")" -eq 1 ]]; then\n  printf '%s\\n' "Other / gate"\nelse\n  printf '%s\\n' "Managed pull request gates / gates"\nfi\n`)
  await writeFile(path.join(bin, "sleep"), "#!/usr/bin/env bash\nexit 0\n")
  await chmod(fakeGh, 0o755)
  await chmod(path.join(bin, "sleep"), 0o755)
  await execFileAsync("bash", ["-euo", "pipefail", "-c", publisherCheckRegistrationBlock(publisherScript)], { cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_COUNT_PATH: countPath, GITHUB_REPOSITORY: "owner/repository" } })
  assert.equal((await readFile(countPath, "utf8")).length, 2)
})

test("workflow verifier rejects workflow self-modification in the generated allowlist", async () => {
  const { workflow, candidateScript } = await inputs()
  assert.throws(() => verifyWorkflowText(workflow, { candidateScript: candidateScript.replace("git add -- managed/upstream.lock.json", "git add -- .github/workflows/upstream-sync.yml") }), /generated candidate allowlist must stage the managed corpus/)
})

test("workflow verifier rejects a write permission on the candidate job", async () => {
  const { workflow } = await inputs()
  assert.throws(() => verifyWorkflowText(workflow.replace("      contents: read", "      contents: write")), /candidate job must use read-only contents permission/)
})

test("workflow verifier rejects a blocked report that does not ensure its label", async () => {
  const { workflow } = await inputs()
  const labelCommand = '          gh label create "status: blocked" --repo "${GITHUB_REPOSITORY}" --color "B60205" --description "Upstream sync requires human review" --force\n'
  assert.throws(() => verifyWorkflowText(workflow.replace(labelCommand, "")), /idempotently ensure its issue label/)
})

test("blocked report renders compact classification values into the issue body", async (t) => {
  const { workflow } = await inputs()
  const root = await mkdtemp(path.join(os.tmpdir(), "steel-blocked-report-"))
  const bin = path.join(root, "bin")
  const artifact = path.join(root, "sync-artifact")
  const capturePath = path.join(root, "gh-arguments")
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(bin, { recursive: true })
  await mkdir(artifact, { recursive: true })
  await writeFile(path.join(artifact, "candidate-metadata.json"), `${JSON.stringify({ sourceSha: "a".repeat(40) })}\n`)
  await writeFile(path.join(artifact, "classification.json"), `${JSON.stringify({ categories: ["API", "BROWSER"], blockedReasons: ["OBSERVED_CORPUS_REQUIRED"], upstreamTraceability: { commits: [{ sha: "a".repeat(40), subject: "source" }], releaseNotes: { status: "NOT_FOUND", paths: [] }, migrationNotes: { status: "NOT_FOUND", paths: [] } } })}\n`)
  const fakeGh = path.join(bin, "gh")
  await writeFile(fakeGh, `#!/usr/bin/env bash\nset -euo pipefail\ncase "\${1:-}:\${2:-}" in\n  issue:list) exit 0 ;;\n  issue:create) printf '%s\\0' "$@" > "\${GH_CAPTURE_PATH}" ;;\n  *) exit 0 ;;\nesac\n`)
  await chmod(fakeGh, 0o755)
  await execFileAsync("bash", ["-euo", "pipefail", "-c", blockedReportRunBlock(workflow)], { cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_CAPTURE_PATH: capturePath, GITHUB_REPOSITORY: "owner/repository", GITHUB_SERVER_URL: "https://github.example", GITHUB_RUN_ID: "123", GH_TOKEN: "fixture-token" } })
  const args = (await readFile(capturePath)).toString("utf8").split("\0").filter(Boolean)
  const body = args[args.indexOf("--body") + 1]
  assert.match(body, /Categories: \["API","BROWSER"\]/u)
  assert.match(body, /Blocked reasons: \["OBSERVED_CORPUS_REQUIRED"\]/u)
  assert.match(body, /Upstream source-range commits: \[/u)
  assert.match(body, /Release-note evidence: \{"status":"NOT_FOUND","paths":\[\]\}/u)
  assert.match(body, /Migration-note evidence: \{"status":"NOT_FOUND","paths":\[\]\}/u)
  assert.match(body, /Blocked evidence artifact: `steel-upstream-sync-/u)
  assert.match(body, /Workflow run: https:\/\/github\.example\/owner\/repository\/actions\/runs\/123/u)
  assert.doesNotMatch(body, /\$\(jq/u)
})

test("publisher renders validated traceability and artifact status instead of literal jq", async (t) => {
  const { publisherScript } = await inputs()
  const root = await mkdtemp(path.join(os.tmpdir(), "steel-publisher-body-"))
  const artifact = path.join(root, "sync-artifact")
  const bodyPath = path.join(root, "body.md")
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(artifact, { recursive: true })
  await writeFile(path.join(artifact, "classification.json"), `${JSON.stringify({ categories: ["API"], blockedReasons: [], upstreamTraceability: { commits: [{ sha: "b".repeat(40), subject: "source" }], releaseNotes: { status: "NOT_FOUND", paths: [] }, migrationNotes: { status: "FOUND", paths: ["docs/migration.md"] } } })}\n`)
  await execFileAsync("bash", ["-euo", "pipefail", "-c", publisherPrBodyBlock(publisherScript)], { cwd: root, env: { ...process.env, BODY_CAPTURE_PATH: bodyPath, SOURCE_SHA: "b".repeat(40), MANAGED_SHA: "a".repeat(40), UPSTREAM_REPOSITORY: "steel-dev/steel-browser", UPSTREAM_DEFAULT_BRANCH: "main", MIRROR_BRANCH: "main", SYNC_BRANCH: "upstream-sync/bbbbbbbbbbbb", PUBLISHED_TIP: "c".repeat(40), MANAGED_BRANCH: "managed", CLASSIFICATION_PATH: "sync-artifact/classification.json", PUBLICATION_MODE: "REUSED_VERIFIED_IMMUTABLE_CANDIDATE", META_CAPTURE_BINDING_SHA256: "d".repeat(64), GITHUB_SERVER_URL: "https://github.example", GITHUB_REPOSITORY: "owner/repository", GITHUB_RUN_ID: "123" } })
  const body = await readFile(bodyPath, "utf8")
  assert.doesNotMatch(body, /\$\(jq/u)
  assert.match(body, /Upstream source-range commits: \[/u)
  assert.match(body, /Migration-note evidence: \{"status":"FOUND","paths":\["docs\/migration\.md"\]\}/u)
  assert.match(body, /Generated artifacts: \{"status":"REUSED_VERIFIED_IMMUTABLE_CANDIDATE"/u)
  assert.match(body, /Before merge, rollback is closing/u)
  assert.match(body, /after merge, rollback is a normal revert/u)
  assert.match(body, /Immutable runtime capture artifact: `steel-upstream-capture-/u)
  assert.match(body, /Workflow run: https:\/\/github\.example\/owner\/repository\/actions\/runs\/123/u)
  assert.match(body, /direct reviewed `ROOT_BUILD` gate/u)
})

test("workflow verifier rejects unused guard definitions with no candidate call sites", async () => {
  const { workflow, candidateScript } = await inputs()
  assert.throws(() => verifyWorkflowText(workflow, { candidateScript: candidateScript.replace(/^\s*if ! verify_upstream_delta; then\s*$/gmu, "  if false; then") }), /candidate must guard upstream-owned paths before and after merge/)
})

test("workflow verifier requires the managed required-check binding in the upstream denylist", async () => {
  const { workflow, candidateScript } = await inputs()
  assert.throws(() => verifyWorkflowText(workflow, { candidateScript: candidateScript.replace("|.github/managed-required-check.json", "") }), /required-check binding/)
})

test("workflow verifier requires the bootstrap contract in the upstream denylist", async () => {
  const { workflow, candidateScript } = await inputs()
  assert.throws(() => verifyWorkflowText(workflow, { candidateScript: candidateScript.replace("|.github/bootstrap-capture-contract.json", "") }), /bootstrap capture contract/)
})

test("workflow verifier rejects removal of the actual candidate gates", async () => {
  const { workflow, candidateScript } = await inputs()
  for (const gate of [
    "run_untrusted node scripts/upstream-sync/run-reviewed-gate.mjs UPSTREAM_CORPUS",
    "run_untrusted node scripts/upstream-sync/run-reviewed-gate.mjs MANAGED",
    candidateTestGate,
    "run_untrusted node scripts/upstream-sync/run-reviewed-gate.mjs ROOT_BUILD",
    "run_untrusted node scripts/upstream-sync/run-reviewed-gate.mjs RAW_STATE",
    "run_untrusted node scripts/upstream-sync/verify-license.mjs",
    'git diff --check "${MANAGED_SHA}...HEAD"',
  ]) {
    assert.throws(() => verifyWorkflowText(workflow, { candidateScript: candidateScript.replace(`${gate}\n`, "") }), /candidate gate is missing from the candidate script/, gate)
  }
})

test("workflow verifier rejects removal of the staged/generated tree oracle", async () => {
  const { workflow, candidateScript } = await inputs()
  assert.throws(() => verifyWorkflowText(workflow, { candidateScript: candidateScript.replace('STAGED_TREE_SHA="$(git write-tree)"\n', "") }), /candidate must snapshot the staged generated tree/)
})

test("workflow verifier rejects a gate neutralized with a successful fallback", async () => {
  const { workflow, candidateScript } = await inputs()
  assert.throws(() => verifyWorkflowText(workflow, { candidateScript: candidateScript.replace(`${candidateTestGate}\n`, `${candidateTestGate} || true\n`) }), /failure neutralizer/)
})

test("workflow verifier rejects tokenized gate neutralizers across shell forms", async () => {
  const { workflow, candidateScript } = await inputs()
  const gate = candidateTestGate
  const neutralizers = [
    `${gate} || :`,
    `${gate} || exit 0`,
    `${gate} || { echo ignored; }`,
    `${gate} && echo ignored`,
    `${gate} && false`,
    `${gate} | tee /tmp/test.log`,
    `${gate} &`,
    `(${gate})`,
    `{ ${gate}; }`,
    `${gate}; true`,
    `run_gate() { ${gate}; }; run_gate || :`,
    `${gate} \\\n|| :`,
    `if ${gate}; then echo ignored; fi`,
    `while\n  ${gate}\ndo\n  echo ignored\ndone`,
    `until\n  ${gate}\ndo\n  echo ignored\ndone`,
    `! ${gate}`,
    `false && ${gate}`,
    `true || ${gate}`,
    `if false; then ${gate}; fi`,
    `while false; do ${gate}; done`,
    `for x in; do ${gate}; done`,
    `for x; do ${gate}; done`,
    `case x in y) ${gate};; esac`,
    `${gate} >/dev/null`,
    `${gate}; set +e`,
    `trap ':' ERR; ${gate}`,
    `docker(){ :; }; ${gate}`,
    `function docker { return 0; }; ${gate}`,
    `alias docker=true; ${gate}`,
    `PATH=/tmp/fake:$PATH; ${gate}`,
  ]
  for (const neutralizer of neutralizers) {
    assert.throws(
      () => verifyWorkflowText(workflow, { candidateScript: candidateScript.replace(`${candidateTestGate}\n`, `${neutralizer}\n`) }),
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
  await execFileAsync("bash", ["-euo", "pipefail", "-c", `false || false & touch ${sentinel}`])
  await access(sentinel)
  await rm(sentinel)
  for (const script of [`false && false; touch ${sentinel}`, `true || false; touch ${sentinel}`, `if false; then false; fi; touch ${sentinel}`, `while false; do false; done; touch ${sentinel}`, `case x in y) false;; esac; touch ${sentinel}`]) {
    await execFileAsync("bash", ["-euo", "pipefail", "-c", script])
    await access(sentinel)
    await rm(sentinel)
  }
  await execFileAsync("bash", ["-euo", "pipefail", "-c", `true; touch ${sentinel}`])
  assert.equal((await readFile(sentinel)).length, 0)
})

test("workflow verifier does not count gate text inside another command", async () => {
  const { workflow, candidateScript } = await inputs()
  assert.throws(
    () => verifyWorkflowText(workflow, { candidateScript: candidateScript.replace(`${candidateTestGate}\n`, `echo ${candidateTestGate}\n`) }),
    /candidate gate is missing from the candidate script: run_untrusted node scripts\/upstream-sync\/run-reviewed-gate\.mjs ROOT_TEST/,
  )
})

test("workflow verifier requires canonical standalone gates even for explicit fail-closed wrappers", async () => {
  const { workflow, candidateScript } = await inputs()
  const failClosed = [
    `${candidateTestGate} || exit 1`,
    `${candidateTestGate} || { echo failed >&2; exit 1; }`,
    `${candidateTestGate} || {\n  echo failed >&2\n  exit 1\n}`,
  ]
  for (const branch of failClosed) {
    assert.throws(() => verifyWorkflowText(workflow, { candidateScript: candidateScript.replace(`${candidateTestGate}\n`, `${branch}\n`) }), /failure neutralizer/, branch)
  }
})

test("workflow verifier binds both trusted runner helper bodies exactly", async () => {
  const { workflow, candidateScript } = await inputs()
  for (const mutation of [
    candidateScript.replace(/  docker run --rm[^\n]+/u, '  "$@" || true'),
    candidateScript.replace(/  docker run --rm[^\n]+/u, "  return 0"),
    candidateScript.replace("--network none ", ""),
    candidateScript.replace("--rm --network", "--network"),
    candidateScript.replace('  env -i "CI=true"', '  "$@" || true\n  env -i "CI=true"'),
    candidateScript.replace(/  docker build --pull=false[^\n]+/u, "  return 0"),
  ]) {
    assert.notEqual(mutation, candidateScript)
    assert.throws(() => verifyWorkflowText(workflow, { candidateScript: mutation }), /helper|failure neutralizer/)
  }
})
