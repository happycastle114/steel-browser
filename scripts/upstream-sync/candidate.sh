#!/usr/bin/env bash
set -euo pipefail
PHASE="${1:-}"
if [[ "${PHASE}" != "capture" && "${PHASE}" != "generate" ]]; then
  echo "usage: candidate.sh <capture|generate>" >&2
  exit 64
fi
ARTIFACT_ROOT="${RUNNER_TEMP:?}/steel-upstream-sync"
mkdir -p "${ARTIFACT_ROOT}"
mkdir -p "${RUNNER_TEMP}/trusted-home"
UNTRUSTED_WORKTREE="${RUNNER_TEMP}/untrusted-candidate-tree"
run_untrusted() {
  docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev,noexec "${UNTRUSTED_GATE_IMAGE}" "$@"
}
build_untrusted_gate_image() {
  docker build --pull=false --iidfile "${UNTRUSTED_GATE_IMAGE_DIGEST_FILE}" --file "${UNTRUSTED_WORKTREE}/scripts/upstream-sync/candidate-gates.Dockerfile" "${UNTRUSTED_WORKTREE}"
}
run_trusted() {
  env -i "CI=true" "HOME=${RUNNER_TEMP}/trusted-home" "PATH=${PATH}" "TMPDIR=${RUNNER_TEMP}" "$@"
}

if [[ "${GITHUB_REPOSITORY}" == "${UPSTREAM_REPOSITORY}" ]]; then
  echo "canonical upstream repository is not a writable fork" >&2
  exit 1
fi
if [[ -z "${GITHUB_REPOSITORY_OWNER}" || -z "${GITHUB_REPOSITORY}" ]]; then
  echo "fork repository identity is missing" >&2
  exit 1
fi

if git remote get-url upstream >/dev/null 2>&1; then
  [[ "$(git remote get-url upstream)" == "${UPSTREAM_URL}" ]] || { echo "existing upstream remote URL drift" >&2; exit 1; }
else
  git remote add upstream "${UPSTREAM_URL}"
fi
UPSTREAM_DEFAULT_BRANCH="$(git ls-remote --symref "${UPSTREAM_URL}" HEAD | awk '$1 == "ref:" && $2 ~ /^refs\/heads\// {sub(/^refs\/heads\//, "", $2); print $2; exit}')"
if [[ -z "${UPSTREAM_DEFAULT_BRANCH}" || ! "${UPSTREAM_DEFAULT_BRANCH}" =~ ^[A-Za-z0-9._/-]+$ ]] || ! git check-ref-format "refs/heads/${UPSTREAM_DEFAULT_BRANCH}"; then
  echo "canonical upstream default branch could not be resolved safely" >&2
  exit 1
fi
git fetch --no-tags upstream "${UPSTREAM_DEFAULT_BRANCH}"
git fetch --no-tags origin "${MANAGED_BRANCH}" "${MIRROR_BRANCH}" || {
  echo "read-only origin fetch failed; refusing to guess whether a ref is absent" >&2
  exit 1
}
unset READ_TOKEN GITHUB_TOKEN GH_TOKEN PUBLISH_TOKEN NODE_AUTH_TOKEN NPM_TOKEN ACTIONS_RUNTIME_TOKEN ACTIONS_ID_TOKEN_REQUEST_TOKEN ACTIONS_ID_TOKEN_REQUEST_URL

SOURCE_SHA="$(git rev-parse "refs/remotes/upstream/${UPSTREAM_DEFAULT_BRANCH}")"
MANAGED_SHA="$(git rev-parse "refs/remotes/origin/${MANAGED_BRANCH}")"
LOCK_SHA="$(node --input-type=module -e 'import { readFile } from "node:fs/promises"; const lock = JSON.parse(await readFile("managed/upstream.lock.json", "utf8")); process.stdout.write(lock.upstreamSha)')"
SYNC_BRANCH="upstream-sync/${SOURCE_SHA:0:12}"
printf 'SOURCE_SHA=%s\nMANAGED_SHA=%s\nSYNC_BRANCH=%s\n' "${SOURCE_SHA}" "${MANAGED_SHA}" "${SYNC_BRANCH}" >> "${GITHUB_ENV}"
printf 'source_sha=%s\nmanaged_sha=%s\nsync_branch=%s\n' "${SOURCE_SHA}" "${MANAGED_SHA}" "${SYNC_BRANCH}" >> "${GITHUB_OUTPUT}"

verify_upstream_delta() {
  while IFS= read -r -d '' changed_path; do
    case "${changed_path}" in
      managed/*|.github/workflows/*|.github/CODEOWNERS|.github/bootstrap-capture-contract.json|.github/managed-required-check.json|.github/managed-gate-manifest.json|.github/rulesets/*|scripts/upstream-sync/*)
        echo "upstream changed fork-owned automation or managed policy: ${changed_path}" >&2
        return 1
        ;;
    esac
  done < <(git diff --name-only -z --find-renames "${MANAGED_SHA}...${SOURCE_SHA}")
}

write_blocked_classification() {
  local observation_flag=()
  local acknowledgement_flag=()
  local blocked_reason_flag=()
  if [[ -n "${CAPTURE_DIR:-}" && -d "${CAPTURE_DIR}" ]]; then
    observation_flag=(--observation-available)
  fi
  if [[ -f "${REVIEW_ACKNOWLEDGEMENT_ROOT}/${SOURCE_SHA}.json" ]]; then
    acknowledgement_flag=(--review-acknowledgement "${REVIEW_ACKNOWLEDGEMENT_ROOT}/${SOURCE_SHA}.json")
  fi
  if [[ -n "${1:-}" ]]; then
    blocked_reason_flag=(--blocked-reason "$1")
  fi
  node scripts/upstream-sync/record-blocked-candidate.mjs \
    --repository-root "${PWD}" \
    --artifact-root "${ARTIFACT_ROOT}" \
    --github-output "${GITHUB_OUTPUT}" \
    --managed-sha "${MANAGED_SHA}" \
    --source-sha "${SOURCE_SHA}" \
    --lock-sha "${LOCK_SHA}" \
    "${observation_flag[@]}" \
    "${acknowledgement_flag[@]}" \
    "${blocked_reason_flag[@]}"
}

if [[ "${PHASE}" == "capture" ]]; then
  if ! verify_upstream_delta; then
    write_blocked_classification "UPSTREAM_SCOPE_CONFLICT"
    exit 0
  fi
  if git merge-base --is-ancestor "${SOURCE_SHA}" "${MANAGED_SHA}"; then
    if [[ "${SOURCE_SHA}" != "${LOCK_SHA}" ]]; then
      echo "managed already contains the source but its lock/corpus is stale; refusing no-change publication" >&2
      write_blocked_classification
      exit 0
    fi
    printf '{"schemaVersion":1,"status":"NO_CHANGE","sourceSha":"%s","managedSha":"%s"}\n' "${SOURCE_SHA}" "${MANAGED_SHA}" > "${ARTIFACT_ROOT}/candidate-metadata.json"
    echo "sync_status=no-change" >> "${GITHUB_OUTPUT}"
    echo "capture_status=skipped" >> "${GITHUB_OUTPUT}"
    exit 0
  fi
fi

CAPTURE_DIR="${ARTIFACT_ROOT}/captured/${SOURCE_SHA}"
CAPTURE_SCRIPT="${ARTIFACT_ROOT}/capture-observation.mjs"
CAPTURE_RUNNER="${ARTIFACT_ROOT}/observation-runner.mjs"
CAPTURE_OBSERVER="${ARTIFACT_ROOT}/steel-runtime-observer.mjs"
CAPTURE_ROUTE_SOURCE="${ARTIFACT_ROOT}/runtime-route-source.mjs"
CAPTURE_PROBES="${ARTIFACT_ROOT}/runtime-probes.mjs"
CAPTURE_CORPUS="${ARTIFACT_ROOT}/runtime-corpus.mjs"
CAPTURE_SCHEMA="${ARTIFACT_ROOT}/corpus-schema.mjs"
CAPTURE_PLAN="${ARTIFACT_ROOT}/runtime-capture-plan.json"
CAPTURE_DOCKERFILE="${ARTIFACT_ROOT}/runtime-capture.Dockerfile"
CAPTURE_BINDING_VERIFIER="${ARTIFACT_ROOT}/verify-capture-binding.mjs"
CAPTURE_SCRIPT_SHA256="$(shasum -a 256 scripts/upstream-sync/capture-observation.mjs | awk '{print $1}')"
CAPTURE_RUNNER_SHA256="$(shasum -a 256 scripts/upstream-sync/observation-runner.mjs | awk '{print $1}')"
CAPTURE_OBSERVER_SHA256="$(shasum -a 256 scripts/upstream-sync/steel-runtime-observer.mjs | awk '{print $1}')"
CAPTURE_ROUTE_SOURCE_SHA256="$(shasum -a 256 scripts/upstream-sync/runtime-route-source.mjs | awk '{print $1}')"
CAPTURE_PROBES_SHA256="$(shasum -a 256 scripts/upstream-sync/runtime-probes.mjs | awk '{print $1}')"
CAPTURE_CORPUS_SHA256="$(shasum -a 256 scripts/upstream-sync/runtime-corpus.mjs | awk '{print $1}')"
CAPTURE_SCHEMA_SHA256="$(shasum -a 256 scripts/upstream-sync/corpus-schema.mjs | awk '{print $1}')"
CAPTURE_PLAN_SHA256="$(shasum -a 256 "managed/tests/upstream/${LOCK_SHA}/route-matrix.json" | awk '{print $1}')"
CAPTURE_SESSION_MODE="$(jq -r '.sessionIdMode' "managed/tests/upstream/${LOCK_SHA}/manifest.json")"
[[ "${CAPTURE_SESSION_MODE}" == "CLIENT_SUPPLIED" ]] || { echo "reviewed capture session mode is unsupported" >&2; exit 1; }
CAPTURE_DOCKERFILE_SHA256="$(shasum -a 256 scripts/upstream-sync/runtime-capture.Dockerfile | awk '{print $1}')"
CAPTURE_BINDING_VERIFIER_SHA256="$(shasum -a 256 scripts/upstream-sync/verify-capture-binding.mjs | awk '{print $1}')"
if [[ "${PHASE}" == "generate" ]]; then
  CAPTURE_STATE="${ARTIFACT_ROOT}/capture-state.json"
  [[ -f "${CAPTURE_STATE}" && -f "${ARTIFACT_ROOT}/capture-binding.json" && -d "${CAPTURE_DIR}" ]] || { echo "immutable pre-gate capture artifact is missing" >&2; exit 1; }
  STATE_SOURCE_SHA="$(jq -r '.sourceSha' "${CAPTURE_STATE}")"
  STATE_MANAGED_SHA="$(jq -r '.managedSha' "${CAPTURE_STATE}")"
  STATE_CAPTURE_BINDING_SHA256="$(jq -r '.captureBindingSha256' "${CAPTURE_STATE}")"
  [[ "${STATE_SOURCE_SHA}" == "${SOURCE_SHA}" && "${STATE_MANAGED_SHA}" == "${MANAGED_SHA}" && "${STATE_CAPTURE_BINDING_SHA256}" =~ ^[0-9a-f]{64}$ ]] || { echo "immutable pre-gate capture state drift" >&2; exit 1; }
  CAPTURE_BINDING="${ARTIFACT_ROOT}/capture-binding.json"
  CAPTURE_BINDING_SHA256="${STATE_CAPTURE_BINDING_SHA256}"
  [[ "$(shasum -a 256 "${CAPTURE_BINDING}" | awk '{print $1}')" == "${CAPTURE_BINDING_SHA256}" ]] || { echo "immutable pre-gate capture digest drift" >&2; exit 1; }
else
cp scripts/upstream-sync/capture-observation.mjs "${CAPTURE_SCRIPT}"
cp scripts/upstream-sync/observation-runner.mjs "${CAPTURE_RUNNER}"
cp scripts/upstream-sync/steel-runtime-observer.mjs "${CAPTURE_OBSERVER}"
cp scripts/upstream-sync/runtime-route-source.mjs "${CAPTURE_ROUTE_SOURCE}"
cp scripts/upstream-sync/runtime-probes.mjs "${CAPTURE_PROBES}"
cp scripts/upstream-sync/runtime-corpus.mjs "${CAPTURE_CORPUS}"
cp scripts/upstream-sync/corpus-schema.mjs "${CAPTURE_SCHEMA}"
cp "managed/tests/upstream/${LOCK_SHA}/route-matrix.json" "${CAPTURE_PLAN}"
cp scripts/upstream-sync/runtime-capture.Dockerfile "${CAPTURE_DOCKERFILE}"
cp scripts/upstream-sync/verify-capture-binding.mjs "${CAPTURE_BINDING_VERIFIER}"
git switch --detach "${SOURCE_SHA}"
WORKER_IMAGE_DIGEST="${ARTIFACT_ROOT}/worker-image-digest"
if [[ "$(shasum -a 256 "${CAPTURE_DOCKERFILE}" | awk '{print $1}')" != "${CAPTURE_DOCKERFILE_SHA256}" ]]; then
  git switch --detach "${MANAGED_SHA}"
  write_blocked_classification "RUNTIME_BUILD_FAILED"
  exit 0
fi
if ! docker build --pull=false --iidfile "${WORKER_IMAGE_DIGEST}" --file "${CAPTURE_DOCKERFILE}" .; then
  git switch --detach "${MANAGED_SHA}"
  write_blocked_classification "RUNTIME_BUILD_FAILED"
  exit 0
fi
if [[ ! "$(<"${WORKER_IMAGE_DIGEST}")" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  git switch --detach "${MANAGED_SHA}"
  write_blocked_classification "RUNTIME_BUILD_FAILED"
  exit 0
fi
if ! STEEL_CAPTURE_SCRIPT_SHA256="${CAPTURE_SCRIPT_SHA256}" \
  STEEL_OBSERVATION_RUNNER_SHA256="${CAPTURE_RUNNER_SHA256}" \
  STEEL_RUNTIME_OBSERVER_SHA256="${CAPTURE_OBSERVER_SHA256}" \
  STEEL_RUNTIME_ROUTE_SOURCE_SHA256="${CAPTURE_ROUTE_SOURCE_SHA256}" \
  STEEL_RUNTIME_PROBES_SHA256="${CAPTURE_PROBES_SHA256}" \
  STEEL_RUNTIME_CORPUS_SHA256="${CAPTURE_CORPUS_SHA256}" \
  STEEL_CORPUS_SCHEMA_SHA256="${CAPTURE_SCHEMA_SHA256}" \
  STEEL_RUNTIME_CAPTURE_PLAN_FILE="${CAPTURE_PLAN}" \
  STEEL_RUNTIME_CAPTURE_PLAN_SHA256="${CAPTURE_PLAN_SHA256}" \
  STEEL_RUNTIME_SESSION_ID_MODE="${CAPTURE_SESSION_MODE}" \
  STEEL_WORKER_IMAGE_DIGEST_FILE="${WORKER_IMAGE_DIGEST}" \
  node "${CAPTURE_SCRIPT}" \
  --repository-root "${PWD}" --upstream-sha "${SOURCE_SHA}" \
  --output-directory "${CAPTURE_DIR}"; then
  echo "RUNTIME_CAPTURE_BLOCKED: repository-owned Steel/browser observation unavailable" >&2
  git switch --detach "${MANAGED_SHA}"
  write_blocked_classification
  exit 0
fi
CAPTURE_BINDING="${ARTIFACT_ROOT}/capture-binding.json"
cp "${CAPTURE_DIR}/observation-provenance.json" "${CAPTURE_BINDING}"
CAPTURE_BINDING_SHA256="$(shasum -a 256 "${CAPTURE_BINDING}" | awk '{print $1}')"
printf '{"schemaVersion":1,"sourceSha":"%s","managedSha":"%s","lockSha":"%s","syncBranch":"%s","captureBindingSha256":"%s"}\n' "${SOURCE_SHA}" "${MANAGED_SHA}" "${LOCK_SHA}" "${SYNC_BRANCH}" "${CAPTURE_BINDING_SHA256}" > "${ARTIFACT_ROOT}/capture-state.json"
git switch --detach "${MANAGED_SHA}"
echo "capture_status=captured" >> "${GITHUB_OUTPUT}"
echo "capture_binding_sha256=${CAPTURE_BINDING_SHA256}" >> "${GITHUB_OUTPUT}"
exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
MERGE_RESULT="$(run_trusted node scripts/upstream-sync/merge-candidate.mjs --repository-root "${PWD}" --managed-sha "${MANAGED_SHA}" --source-sha "${SOURCE_SHA}")"
if [[ "$(jq -r '.status' <<<"${MERGE_RESULT}")" == "BLOCKED" ]]; then
  [[ "$(jq -r '.blockedReason' <<<"${MERGE_RESULT}")" == "MERGE_CONFLICT" ]] || { echo "candidate merge returned an unknown block reason" >&2; exit 1; }
  write_blocked_classification "MERGE_CONFLICT"
  exit 0
fi
MERGE_COMMIT_SHA="$(jq -r '.mergeCommitSha' <<<"${MERGE_RESULT}")"
[[ "${MERGE_COMMIT_SHA}" =~ ^[0-9a-f]{40}$ && "$(git rev-parse HEAD)" == "${MERGE_COMMIT_SHA}" ]] || { echo "candidate merge result is invalid" >&2; exit 1; }
if ! verify_upstream_delta; then
  git reset --hard "${MANAGED_SHA}"
  write_blocked_classification "UPSTREAM_SCOPE_CONFLICT"
  exit 0
fi

run_trusted node scripts/upstream-sync/prepare-corpus.mjs \
  --upstream-sha "${SOURCE_SHA}" \
  --observed-corpus-directory "${CAPTURE_DIR}"
REVIEW_ACKNOWLEDGEMENT_FLAG=()
if [[ -f "${REVIEW_ACKNOWLEDGEMENT_ROOT}/${SOURCE_SHA}.json" ]]; then
  REVIEW_ACKNOWLEDGEMENT_FLAG=(--review-acknowledgement "${REVIEW_ACKNOWLEDGEMENT_ROOT}/${SOURCE_SHA}.json")
fi
run_trusted node scripts/upstream-sync/classify-upstream.mjs \
  --managed-sha "${MANAGED_SHA}" \
  --source-sha "${SOURCE_SHA}" \
  --lock-sha "${LOCK_SHA}" \
  --merge-sha "${MERGE_COMMIT_SHA}" \
  --observation-available \
  "${REVIEW_ACKNOWLEDGEMENT_FLAG[@]}" \
  --evidence-root "${PWD}" \
  --output "managed/tests/upstream/${SOURCE_SHA}/classification.json"
cp "managed/tests/upstream/${SOURCE_SHA}/classification.json" "${ARTIFACT_ROOT}/classification.json"
CLASSIFICATION_BLOCKED="$(CLASSIFICATION_PATH="managed/tests/upstream/${SOURCE_SHA}/classification.json" node --input-type=module -e 'import { readFile } from "node:fs/promises"; const value = JSON.parse(await readFile(process.env.CLASSIFICATION_PATH, "utf8")); process.stdout.write(String(value.blocked))')"
if [[ "${CLASSIFICATION_BLOCKED}" == "true" ]]; then
  printf '{"schemaVersion":1,"status":"BLOCKED","sourceSha":"%s","managedSha":"%s"}\n' "${SOURCE_SHA}" "${MANAGED_SHA}" > "${ARTIFACT_ROOT}/candidate-metadata.json"
  echo "sync_status=blocked" >> "${GITHUB_OUTPUT}"
  exit 0
fi
verify_generated_worktree() {
  while IFS= read -r -d '' changed_path; do
    case "${changed_path}" in
      managed/upstream.lock.json|managed/shared/src/upstream-observed-receipt.ts|managed/tests/upstream/${SOURCE_SHA}/*)
        ;;
      .github/workflows/upstream-sync.yml)
        echo "workflow self-modification is forbidden" >&2
        return 1
        ;;
      *)
        echo "generated candidate changed an unauthorized path: ${changed_path}" >&2
        return 1
        ;;
    esac
  done < <(
    {
      git diff --name-only -z
      git diff --cached --name-only -z
      git ls-files --others --exclude-standard -z
    } | sort -zu
  )
}

verify_generated_worktree
git switch -c "${SYNC_BRANCH}"
git add -- managed/upstream.lock.json "managed/tests/upstream/${SOURCE_SHA}" managed/shared/src/upstream-observed-receipt.ts
if git diff --cached --quiet; then
  echo "observed corpus preparation produced no committed changes" >&2
  exit 1
fi
while IFS= read -r -d '' staged_path; do
  case "${staged_path}" in
    managed/upstream.lock.json|managed/shared/src/upstream-observed-receipt.ts|managed/tests/upstream/${SOURCE_SHA}/*)
      ;;
    .github/workflows/upstream-sync.yml)
      echo "workflow file may not be part of generated candidate changes" >&2
      exit 1
      ;;
    *)
      echo "staged candidate path is outside the generated allowlist: ${staged_path}" >&2
      exit 1
      ;;
  esac
done < <(git diff --cached --name-only -z)

STAGED_TREE_SHA="$(git write-tree)"
git -c core.hooksPath=/dev/null commit -m "ci(managed): record observed upstream corpus ${SOURCE_SHA}"
COMMITTED_TREE_SHA="$(git rev-parse HEAD^{tree})"
if [[ "${COMMITTED_TREE_SHA}" != "${STAGED_TREE_SHA}" ]]; then
  echo "generated commit tree differs from the staged generated tree" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain=v1 --untracked-files=all)" ]]; then
  echo "candidate tree is not clean after the generated commit" >&2
  exit 1
fi
COMMITTED_PATHS="$(git diff-tree --no-commit-id --name-only -r HEAD)"
grep -Fxq "managed/upstream.lock.json" <<<"${COMMITTED_PATHS}"
grep -Fxq "managed/shared/src/upstream-observed-receipt.ts" <<<"${COMMITTED_PATHS}"
grep -Fq "managed/tests/upstream/${SOURCE_SHA}/" <<<"${COMMITTED_PATHS}"
if grep -Fxq ".github/workflows/upstream-sync.yml" <<<"${COMMITTED_PATHS}"; then
  echo "candidate commit contains workflow self-modification" >&2
  exit 1
fi

CANDIDATE_COMMIT_SHA="$(git rev-parse HEAD)"
CANDIDATE_TREE_SHA="$(git rev-parse HEAD^{tree})"
[[ ! -e "${UNTRUSTED_WORKTREE}" ]] || { echo "isolated untrusted worktree already exists" >&2; exit 1; }
mkdir -p "${UNTRUSTED_WORKTREE}"
git archive "${CANDIDATE_COMMIT_SHA}" | tar -x -C "${UNTRUSTED_WORKTREE}"
UNTRUSTED_GATE_IMAGE_DIGEST_FILE="${ARTIFACT_ROOT}/untrusted-gate-image-digest"
build_untrusted_gate_image
UNTRUSTED_GATE_IMAGE="$(<"${UNTRUSTED_GATE_IMAGE_DIGEST_FILE}")"
[[ "${UNTRUSTED_GATE_IMAGE}" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "untrusted gate image digest is invalid" >&2; exit 1; }
if [[ "$(shasum -a 256 "${CAPTURE_BINDING}" | awk '{print $1}')" != "${CAPTURE_BINDING_SHA256}" ]] || \
  [[ "$(shasum -a 256 "${CAPTURE_BINDING_VERIFIER}" | awk '{print $1}')" != "${CAPTURE_BINDING_VERIFIER_SHA256}" ]]; then
  echo "pre-untrusted capture binding or verifier changed during candidate gates" >&2
  exit 1
fi
set -euo pipefail
# reviewed-required-gates: begin
run_untrusted node --test scripts/upstream-sync/*.test.mjs
run_trusted node scripts/upstream-sync/verify-package-scripts.mjs
run_untrusted node scripts/upstream-sync/run-reviewed-gate.mjs UPSTREAM_CORPUS
run_untrusted node scripts/upstream-sync/run-reviewed-gate.mjs MANAGED
run_untrusted node scripts/upstream-sync/run-reviewed-gate.mjs ROOT_TEST
run_untrusted node scripts/upstream-sync/run-reviewed-gate.mjs ROOT_BUILD
run_untrusted node scripts/upstream-sync/run-reviewed-gate.mjs RAW_STATE
run_untrusted node scripts/upstream-sync/verify-license.mjs
git diff --check "${MANAGED_SHA}...HEAD"
git diff --quiet
git diff --cached --quiet
run_trusted node "${CAPTURE_BINDING_VERIFIER}" --repository-root "${PWD}" --commit-sha "${CANDIDATE_COMMIT_SHA}" --source-sha "${SOURCE_SHA}" --binding "${CAPTURE_BINDING}"
run_trusted node scripts/upstream-sync/verify-candidate-commit.mjs --commit-sha "${CANDIDATE_COMMIT_SHA}" --merge-commit-sha "${MERGE_COMMIT_SHA}" --managed-sha "${MANAGED_SHA}" --source-sha "${SOURCE_SHA}" --tree-sha "${CANDIDATE_TREE_SHA}"
# reviewed-required-gates: end
git bundle create "${ARTIFACT_ROOT}/candidate.bundle" "refs/heads/${SYNC_BRANCH}" "^${MANAGED_SHA}"
printf '{"schemaVersion":1,"status":"READY","sourceSha":"%s","managedSha":"%s","syncBranch":"%s","mergeCommitSha":"%s","candidateCommitSha":"%s","candidateTreeSha":"%s","captureBindingSha256":"%s"}\n' \
  "${SOURCE_SHA}" "${MANAGED_SHA}" "${SYNC_BRANCH}" "${MERGE_COMMIT_SHA}" "${CANDIDATE_COMMIT_SHA}" "${CANDIDATE_TREE_SHA}" "${CAPTURE_BINDING_SHA256}" > "${ARTIFACT_ROOT}/candidate-metadata.json"
echo "sync_status=ready" >> "${GITHUB_OUTPUT}"
