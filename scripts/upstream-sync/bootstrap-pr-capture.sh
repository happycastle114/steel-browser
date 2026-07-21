#!/usr/bin/env bash
set -euo pipefail

ARTIFACT_ROOT="${RUNNER_TEMP:?}/steel-managed-pr-capture"
SOURCE_WORKTREE=""

cleanup_source_worktree() {
  if [[ -n "${SOURCE_WORKTREE}" && -d "${SOURCE_WORKTREE}" ]]; then
    git worktree remove --force "${SOURCE_WORKTREE}"
  fi
}
trap cleanup_source_worktree EXIT

capture_is_required() {
  while IFS= read -r -d '' changed_path; do
    case "${changed_path}" in
      .github/workflows/managed-pr-gates.yml|.github/workflows/upstream-sync.yml|.github/bootstrap-capture-contract.json|.github/managed-gate-manifest.json|.github/managed-required-check.json|managed/upstream.lock.json|managed/tests/upstream/*|scripts/upstream-sync/*)
        return 0
        ;;
    esac
  done < <(git diff --name-only -z "${PR_BASE_SHA}...HEAD")
  return 1
}

[[ "${PR_BASE_SHA}" =~ ^[0-9a-f]{40}$ ]] || { echo "bootstrap capture base SHA is invalid" >&2; exit 1; }
printf 'capture_required=false\n' >> "${GITHUB_OUTPUT}"
if ! capture_is_required; then
  echo "BOOTSTRAP_RUNTIME_CAPTURE_SKIPPED no capture-sensitive paths changed"
  exit 0
fi

unset READ_TOKEN GITHUB_TOKEN GH_TOKEN PUBLISH_TOKEN NODE_AUTH_TOKEN NPM_TOKEN ACTIONS_RUNTIME_TOKEN ACTIONS_ID_TOKEN_REQUEST_TOKEN ACTIONS_ID_TOKEN_REQUEST_URL
UPSTREAM_URL="https://github.com/steel-dev/steel-browser.git"
if git remote get-url bootstrap-upstream >/dev/null 2>&1; then
  [[ "$(git remote get-url bootstrap-upstream)" == "${UPSTREAM_URL}" ]] || { echo "bootstrap upstream URL drift" >&2; exit 1; }
else
  git remote add bootstrap-upstream "${UPSTREAM_URL}"
fi
UPSTREAM_DEFAULT_BRANCH="$(git ls-remote --symref "${UPSTREAM_URL}" HEAD | awk '$1 == "ref:" && $2 ~ /^refs\/heads\// {sub(/^refs\/heads\//, "", $2); print $2; exit}')"
[[ "${UPSTREAM_DEFAULT_BRANCH}" =~ ^[A-Za-z0-9._/-]+$ ]] && git check-ref-format "refs/heads/${UPSTREAM_DEFAULT_BRANCH}" || { echo "bootstrap upstream default branch is invalid" >&2; exit 1; }
SOURCE_SHA="$(git ls-remote "${UPSTREAM_URL}" "refs/heads/${UPSTREAM_DEFAULT_BRANCH}" | awk '{print $1; exit}')"
[[ "${SOURCE_SHA}" =~ ^[0-9a-f]{40}$ ]] || { echo "bootstrap source SHA is invalid" >&2; exit 1; }
git fetch --no-tags bootstrap-upstream "${SOURCE_SHA}"
[[ "$(git rev-parse FETCH_HEAD)" == "${SOURCE_SHA}" ]] || { echo "bootstrap fetch did not retain the resolved source SHA" >&2; exit 1; }

LOCK_SHA="$(jq -er '.upstreamSha | select(test("^[0-9a-f]{40}$"))' managed/upstream.lock.json)"
CAPTURE_PLAN="${PWD}/managed/tests/upstream/${LOCK_SHA}/route-matrix.json"
CAPTURE_SESSION_MODE="$(jq -er '.sessionIdMode | select(. == "CLIENT_SUPPLIED")' "${PWD}/managed/tests/upstream/${LOCK_SHA}/manifest.json")"
[[ -f "${CAPTURE_PLAN}" ]] || { echo "bootstrap reviewed capture plan is missing" >&2; exit 1; }
[[ ! -e "${ARTIFACT_ROOT}" ]] || { echo "bootstrap capture artifact root already exists" >&2; exit 1; }
mkdir -p "${ARTIFACT_ROOT}"
SOURCE_WORKTREE="${RUNNER_TEMP}/steel-bootstrap-source-${SOURCE_SHA}"
git worktree add --detach "${SOURCE_WORKTREE}" "${SOURCE_SHA}"

WORKER_IMAGE_DIGEST_FILE="${ARTIFACT_ROOT}/worker-image-digest"
docker build --pull=false --iidfile "${WORKER_IMAGE_DIGEST_FILE}" --file "${PWD}/scripts/upstream-sync/runtime-capture.Dockerfile" "${SOURCE_WORKTREE}"
[[ "$(<"${WORKER_IMAGE_DIGEST_FILE}")" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "bootstrap worker image digest is invalid" >&2; exit 1; }

CAPTURE_DIRECTORY="${ARTIFACT_ROOT}/captured/${SOURCE_SHA}"
STEEL_CAPTURE_SCRIPT_SHA256="$(shasum -a 256 scripts/upstream-sync/capture-observation.mjs | awk '{print $1}')" \
STEEL_OBSERVATION_RUNNER_SHA256="$(shasum -a 256 scripts/upstream-sync/observation-runner.mjs | awk '{print $1}')" \
STEEL_RUNTIME_OBSERVER_SHA256="$(shasum -a 256 scripts/upstream-sync/steel-runtime-observer.mjs | awk '{print $1}')" \
STEEL_RUNTIME_ROUTE_SOURCE_SHA256="$(shasum -a 256 scripts/upstream-sync/runtime-route-source.mjs | awk '{print $1}')" \
STEEL_RUNTIME_PROBES_SHA256="$(shasum -a 256 scripts/upstream-sync/runtime-probes.mjs | awk '{print $1}')" \
STEEL_RUNTIME_CORPUS_SHA256="$(shasum -a 256 scripts/upstream-sync/runtime-corpus.mjs | awk '{print $1}')" \
STEEL_CORPUS_SCHEMA_SHA256="$(shasum -a 256 scripts/upstream-sync/corpus-schema.mjs | awk '{print $1}')" \
STEEL_RUNTIME_CAPTURE_PLAN_FILE="${CAPTURE_PLAN}" \
STEEL_RUNTIME_CAPTURE_PLAN_SHA256="$(shasum -a 256 "${CAPTURE_PLAN}" | awk '{print $1}')" \
STEEL_RUNTIME_SESSION_ID_MODE="${CAPTURE_SESSION_MODE}" \
STEEL_WORKER_IMAGE_DIGEST_FILE="${WORKER_IMAGE_DIGEST_FILE}" \
node scripts/upstream-sync/capture-observation.mjs \
  --repository-root "${SOURCE_WORKTREE}" \
  --upstream-sha "${SOURCE_SHA}" \
  --output-directory "${CAPTURE_DIRECTORY}"

CAPTURE_BINDING="${ARTIFACT_ROOT}/capture-binding.json"
cp "${CAPTURE_DIRECTORY}/observation-provenance.json" "${CAPTURE_BINDING}"
node scripts/upstream-sync/verify-runtime-capture.mjs --capture-directory "${CAPTURE_DIRECTORY}" --binding "${CAPTURE_BINDING}" --repository-root "${SOURCE_WORKTREE}" --source-sha "${SOURCE_SHA}"
CAPTURE_BINDING_SHA256="$(shasum -a 256 "${CAPTURE_BINDING}" | awk '{print $1}')"
ARTIFACT_NAME="steel-bootstrap-capture-${SOURCE_SHA}-${CAPTURE_BINDING_SHA256}"
jq -nce --arg sourceSha "${SOURCE_SHA}" --arg captureBindingSha256 "${CAPTURE_BINDING_SHA256}" --arg artifactName "${ARTIFACT_NAME}" --arg capturePath "captured/${SOURCE_SHA}" '{schemaVersion:1,status:"VERIFIED",sourceSha:$sourceSha,captureBindingSha256:$captureBindingSha256,artifactName:$artifactName,capturePath:$capturePath}' > "${ARTIFACT_ROOT}/bootstrap-capture-metadata.json"
printf 'capture_required=true\nsource_sha=%s\ncapture_binding_sha256=%s\nartifact_name=%s\n' "${SOURCE_SHA}" "${CAPTURE_BINDING_SHA256}" "${ARTIFACT_NAME}" >> "${GITHUB_OUTPUT}"
printf '### Bootstrap runtime capture\n\n- Source SHA: `%s`\n- Artifact: `%s`\n- Artifact path: `%s`\n- Capture binding SHA-256: `%s`\n- Run: %s/%s/actions/runs/%s\n' "${SOURCE_SHA}" "${ARTIFACT_NAME}" "captured/${SOURCE_SHA}" "${CAPTURE_BINDING_SHA256}" "${GITHUB_SERVER_URL}" "${GITHUB_REPOSITORY}" "${GITHUB_RUN_ID}" >> "${GITHUB_STEP_SUMMARY}"
