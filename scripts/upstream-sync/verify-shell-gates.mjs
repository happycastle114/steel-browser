export const REVIEWED_GATE_MARKER = Object.freeze({
  BEGIN: "# reviewed-required-gates: begin",
  END: "# reviewed-required-gates: end",
})

export const GATE_COMMANDS = Object.freeze([
  "run_untrusted node --test scripts/upstream-sync/*.test.mjs",
  "run_trusted node scripts/upstream-sync/verify-package-scripts.mjs",
  "run_untrusted node scripts/upstream-sync/run-reviewed-gate.mjs UPSTREAM_CORPUS",
  "run_untrusted node scripts/upstream-sync/run-reviewed-gate.mjs MANAGED",
  "run_untrusted node scripts/upstream-sync/run-reviewed-gate.mjs ROOT_TEST",
  "run_untrusted node scripts/upstream-sync/run-reviewed-gate.mjs ROOT_BUILD",
  "run_untrusted node scripts/upstream-sync/run-reviewed-gate.mjs RAW_STATE",
  "run_untrusted node scripts/upstream-sync/verify-license.mjs",
  'git diff --check "${MANAGED_SHA}...HEAD"',
  "git diff --quiet",
  "git diff --cached --quiet",
  'run_trusted node "${CAPTURE_BINDING_VERIFIER}" --repository-root "${PWD}" --commit-sha "${CANDIDATE_COMMIT_SHA}" --source-sha "${SOURCE_SHA}" --binding "${CAPTURE_BINDING}"',
  'run_trusted node scripts/upstream-sync/verify-candidate-commit.mjs --commit-sha "${CANDIDATE_COMMIT_SHA}" --merge-commit-sha "${MERGE_COMMIT_SHA}" --managed-sha "${MANAGED_SHA}" --source-sha "${SOURCE_SHA}" --tree-sha "${CANDIDATE_TREE_SHA}"',
])

export const RUN_UNTRUSTED_DEFINITION = Object.freeze([
  "run_untrusted() {",
  '  docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev,noexec "${UNTRUSTED_GATE_IMAGE}" "$@"',
  "}",
].join("\n"))

export const BUILD_UNTRUSTED_IMAGE_DEFINITION = Object.freeze([
  "build_untrusted_gate_image() {",
  '  docker build --pull=false --iidfile "${UNTRUSTED_GATE_IMAGE_DIGEST_FILE}" --file "${UNTRUSTED_WORKTREE}/scripts/upstream-sync/candidate-gates.Dockerfile" "${UNTRUSTED_WORKTREE}"',
  "}",
].join("\n"))

export const RUN_TRUSTED_DEFINITION = Object.freeze([
  "run_trusted() {",
  '  env -i "CI=true" "HOME=${RUNNER_TEMP}/trusted-home" "PATH=${PATH}" "TMPDIR=${RUNNER_TEMP}" "$@"',
  "}",
].join("\n"))

function trimmedLines(value) {
  return value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
}

function extractReviewedGateBlock(candidate) {
  const lines = candidate.split(/\r?\n/u)
  const beginIndexes = lines.flatMap((line, index) => line === REVIEWED_GATE_MARKER.BEGIN ? [index] : [])
  const endIndexes = lines.flatMap((line, index) => line === REVIEWED_GATE_MARKER.END ? [index] : [])
  if (beginIndexes.length !== 1 || endIndexes.length !== 1 || beginIndexes[0] >= endIndexes[0]) {
    throw new Error("candidate script contains a failure neutralizer: reviewed gate markers are not exact")
  }
  return lines.slice(beginIndexes[0] + 1, endIndexes[0]).join("\n")
}

function assertNoCommandShadow(candidate) {
  if (/(?:^|[;\n])\s*(?:function\s+)?(?:docker|env|git|id|node|npm)\s*(?:\(\s*\))?\s*\{/mu.test(candidate) || /(?:^|[;\n])\s*alias\s+(?:docker|env|git|id|node|npm)=/mu.test(candidate) || /(?:^|[;\n])\s*(?:export\s+)?PATH\s*=/mu.test(candidate)) {
    throw new Error("candidate script contains a failure neutralizer: required command shadow or PATH mutation")
  }
}

function assertExactUntrustedRunner(candidate, requiredCommands) {
  if (!requiredCommands.some((command) => command.startsWith("run_untrusted "))) return
  const definitions = [...candidate.matchAll(/^run_untrusted\(\) \{\n[\s\S]*?^\}$/gmu)].map((match) => match[0])
  if (definitions.length !== 1 || definitions[0] !== RUN_UNTRUSTED_DEFINITION) {
    throw new Error("candidate script contains a failure neutralizer: run_untrusted helper is not the exact reviewed definition")
  }
  if ([...candidate.matchAll(/^(?:function\s+)?run_untrusted(?:\s*\(\))?\s*\{/gmu)].length !== 1) {
    throw new Error("candidate script contains a failure neutralizer: run_untrusted helper definition drift")
  }
}

function assertExactTrustedRunner(candidate, requiredCommands) {
  if (!requiredCommands.some((command) => command.startsWith("run_trusted "))) return
  const definitions = [...candidate.matchAll(/^run_trusted\(\) \{\n[\s\S]*?^\}$/gmu)].map((match) => match[0])
  if (definitions.length !== 1 || definitions[0] !== RUN_TRUSTED_DEFINITION) {
    throw new Error("candidate script contains a failure neutralizer: run_trusted helper is not the exact reviewed definition")
  }
  if ([...candidate.matchAll(/^(?:function\s+)?run_trusted(?:\s*\(\))?\s*\{/gmu)].length !== 1) {
    throw new Error("candidate script contains a failure neutralizer: run_trusted helper definition drift")
  }
}

function assertExactGateImageBuilder(candidate, requiredCommands) {
  if (!requiredCommands.some((command) => command.startsWith("run_untrusted "))) return
  const definitions = [...candidate.matchAll(/^build_untrusted_gate_image\(\) \{\n[\s\S]*?^\}$/gmu)].map((match) => match[0])
  if (definitions.length !== 1 || definitions[0] !== BUILD_UNTRUSTED_IMAGE_DEFINITION) {
    throw new Error("candidate script contains a failure neutralizer: gate image builder is not the exact reviewed definition")
  }
}

export function hasGateCommand(candidate, command) {
  const prefix = Array.isArray(command) ? command.join(" ") : command
  return trimmedLines(candidate).some((line) => line === prefix || line.startsWith(`${prefix} `))
}

export function verifyFailClosedGates(candidate, requiredCommands = GATE_COMMANDS) {
  assertNoCommandShadow(candidate)
  assertExactUntrustedRunner(candidate, requiredCommands)
  assertExactTrustedRunner(candidate, requiredCommands)
  assertExactGateImageBuilder(candidate, requiredCommands)
  const reviewedBlock = extractReviewedGateBlock(candidate)
  if (reviewedBlock !== requiredCommands.join("\n")) {
    throw new Error("candidate script contains a failure neutralizer: required gates must be one exact reviewed standalone block")
  }
  const allLines = trimmedLines(candidate)
  for (const command of requiredCommands) {
    const occurrences = allLines.filter((line) => line === command)
    if (occurrences.length !== 1) {
      throw new Error(`candidate script contains a failure neutralizer: required gate occurrence drift: ${command}`)
    }
  }
}
