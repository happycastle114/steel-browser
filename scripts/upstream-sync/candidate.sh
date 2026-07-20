#!/usr/bin/env bash
set -euo pipefail
ARTIFACT_ROOT="${RUNNER_TEMP:?}/steel-upstream-sync"
mkdir -p "${ARTIFACT_ROOT}"

if [[ "${GITHUB_REPOSITORY}" == "${UPSTREAM_REPOSITORY}" ]]; then
  echo "canonical upstream repository is not a writable fork" >&2
  exit 1
fi
if [[ -z "${GITHUB_REPOSITORY_OWNER}" || -z "${GITHUB_REPOSITORY}" ]]; then
  echo "fork repository identity is missing" >&2
  exit 1
fi

git remote add upstream "${UPSTREAM_URL}"
UPSTREAM_DEFAULT_BRANCH="$(git ls-remote --symref "${UPSTREAM_URL}" HEAD | awk '$1 == "ref:" && $2 ~ /^refs\/heads\// {sub(/^refs\/heads\//, "", $2); print $2; exit}')"
if [[ -z "${UPSTREAM_DEFAULT_BRANCH}" || ! "${UPSTREAM_DEFAULT_BRANCH}" =~ ^[A-Za-z0-9._/-]+$ ]] || ! git check-ref-format "refs/heads/${UPSTREAM_DEFAULT_BRANCH}"; then
  echo "canonical upstream default branch could not be resolved safely" >&2
  exit 1
fi
git fetch --no-tags upstream "${UPSTREAM_DEFAULT_BRANCH}"
git -c "http.extraheader=AUTHORIZATION: bearer ${READ_TOKEN}" fetch --no-tags origin "${MANAGED_BRANCH}" "${MIRROR_BRANCH}" || {
  echo "read-only origin fetch failed; refusing to guess whether a ref is absent" >&2
  exit 1
}
unset READ_TOKEN GITHUB_TOKEN GH_TOKEN PUBLISH_TOKEN ACTIONS_RUNTIME_TOKEN ACTIONS_ID_TOKEN_REQUEST_TOKEN ACTIONS_ID_TOKEN_REQUEST_URL

SOURCE_SHA="$(git rev-parse "refs/remotes/upstream/${UPSTREAM_DEFAULT_BRANCH}")"
MANAGED_SHA="$(git rev-parse "refs/remotes/origin/${MANAGED_BRANCH}")"
LOCK_SHA="$(node --input-type=module -e 'import { readFile } from "node:fs/promises"; const lock = JSON.parse(await readFile("managed/upstream.lock.json", "utf8")); process.stdout.write(lock.upstreamSha)')"
SYNC_BRANCH="upstream-sync/${SOURCE_SHA}-${MANAGED_SHA}"
printf 'SOURCE_SHA=%s\nMANAGED_SHA=%s\nSYNC_BRANCH=%s\n' "${SOURCE_SHA}" "${MANAGED_SHA}" "${SYNC_BRANCH}" >> "${GITHUB_ENV}"
printf 'source_sha=%s\nmanaged_sha=%s\nsync_branch=%s\n' "${SOURCE_SHA}" "${MANAGED_SHA}" "${SYNC_BRANCH}" >> "${GITHUB_OUTPUT}"

verify_upstream_delta() {
  while IFS= read -r -d '' changed_path; do
    case "${changed_path}" in
      managed/*|.github/workflows/*|.github/CODEOWNERS|.github/rulesets/*|scripts/upstream-sync/*)
        echo "upstream changed fork-owned automation or managed policy: ${changed_path}" >&2
        return 1
        ;;
    esac
  done < <(git diff --name-only -z --find-renames "${MANAGED_SHA}...${SOURCE_SHA}")
}

write_blocked_classification() {
  local observation_flag=()
  local acknowledgement_flag=()
  if [[ -n "${CAPTURE_DIR:-}" && -d "${CAPTURE_DIR}" ]]; then
    observation_flag=(--observation-available)
  fi
  if [[ -f "${REVIEW_ACKNOWLEDGEMENT_ROOT}/${SOURCE_SHA}.json" ]]; then
    acknowledgement_flag=(--review-acknowledgement "${REVIEW_ACKNOWLEDGEMENT_ROOT}/${SOURCE_SHA}.json")
  fi
  node scripts/upstream-sync/classify-upstream.mjs \
    --managed-sha "${MANAGED_SHA}" \
    --source-sha "${SOURCE_SHA}" \
    --lock-sha "${LOCK_SHA}" \
    "${observation_flag[@]}" \
    "${acknowledgement_flag[@]}" \
    --output "${ARTIFACT_ROOT}/classification.json"
  printf '{"schemaVersion":1,"status":"BLOCKED","sourceSha":"%s","managedSha":"%s"}\n' "${SOURCE_SHA}" "${MANAGED_SHA}" > "${ARTIFACT_ROOT}/candidate-metadata.json"
  echo "sync_status=blocked" >> "${GITHUB_OUTPUT}"
}

verify_upstream_delta
if git merge-base --is-ancestor "${SOURCE_SHA}" "${MANAGED_SHA}"; then
  if [[ "${SOURCE_SHA}" != "${LOCK_SHA}" ]]; then
    echo "managed already contains the source but its lock/corpus is stale; refusing no-change publication" >&2
    write_blocked_classification
    exit 0
  fi
  printf '{"schemaVersion":1,"status":"NO_CHANGE","sourceSha":"%s","managedSha":"%s"}\n' "${SOURCE_SHA}" "${MANAGED_SHA}" > "${ARTIFACT_ROOT}/candidate-metadata.json"
  echo "sync_status=no-change" >> "${GITHUB_OUTPUT}"
  exit 0
fi

CAPTURE_EXECUTABLE=""
if [[ -n "${STEEL_REVIEWED_CAPTURE_EXECUTABLE:-}" ]]; then
  if ! CAPTURE_EXECUTABLE="$(command -v "${STEEL_REVIEWED_CAPTURE_EXECUTABLE}" 2>/dev/null)"; then
    CAPTURE_EXECUTABLE=""
  fi
fi
if [[ -z "${CAPTURE_EXECUTABLE}" ]]; then
  echo "a reviewed Steel runtime capture executable is required; copied corpora are not accepted" >&2
  write_blocked_classification
  exit 0
fi
CAPTURE_DIR="${ARTIFACT_ROOT}/captured/${SOURCE_SHA}"
CAPTURE_SCRIPT="${ARTIFACT_ROOT}/capture-observation.mjs"
cp scripts/upstream-sync/capture-observation.mjs "${CAPTURE_SCRIPT}"
git switch --detach "${SOURCE_SHA}"
node "${CAPTURE_SCRIPT}" \
  --repository-root "${PWD}" --upstream-sha "${SOURCE_SHA}" \
  --output-directory "${CAPTURE_DIR}" --runtime-executable "${CAPTURE_EXECUTABLE}" \
  --runtime-args-json "${STEEL_REVIEWED_CAPTURE_ARGS_JSON:-[]}"
git switch --detach "${MANAGED_SHA}"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git merge --no-edit --no-ff "${SOURCE_SHA}"
MERGE_COMMIT_SHA="$(git rev-parse HEAD)"
verify_upstream_delta

npm ci
node scripts/upstream-sync/prepare-corpus.mjs \
  --upstream-sha "${SOURCE_SHA}" \
  --observed-corpus-directory "${CAPTURE_DIR}"
REVIEW_ACKNOWLEDGEMENT_FLAG=()
if [[ -f "${REVIEW_ACKNOWLEDGEMENT_ROOT}/${SOURCE_SHA}.json" ]]; then
  REVIEW_ACKNOWLEDGEMENT_FLAG=(--review-acknowledgement "${REVIEW_ACKNOWLEDGEMENT_ROOT}/${SOURCE_SHA}.json")
fi
node scripts/upstream-sync/classify-upstream.mjs \
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
npm run verify:upstream-corpus

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
git commit -m "ci(managed): record observed upstream corpus ${SOURCE_SHA}"
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

node --test scripts/upstream-sync/*.test.mjs
npm run check:managed
npm run test
npm run build
node scripts/upstream-sync/verify-license.mjs
git diff --check HEAD^ HEAD

CANDIDATE_COMMIT_SHA="$(git rev-parse HEAD)"
CANDIDATE_TREE_SHA="$(git rev-parse HEAD^{tree})"
node scripts/upstream-sync/verify-candidate-commit.mjs \
  --commit-sha "${CANDIDATE_COMMIT_SHA}" \
  --merge-commit-sha "${MERGE_COMMIT_SHA}" \
  --managed-sha "${MANAGED_SHA}" \
  --source-sha "${SOURCE_SHA}" \
  --tree-sha "${CANDIDATE_TREE_SHA}"
git bundle create "${ARTIFACT_ROOT}/candidate.bundle" "refs/heads/${SYNC_BRANCH}" "^${MANAGED_SHA}"
printf '{"schemaVersion":1,"status":"READY","sourceSha":"%s","managedSha":"%s","syncBranch":"%s","mergeCommitSha":"%s","candidateCommitSha":"%s","candidateTreeSha":"%s"}\n' \
  "${SOURCE_SHA}" "${MANAGED_SHA}" "${SYNC_BRANCH}" "${MERGE_COMMIT_SHA}" "${CANDIDATE_COMMIT_SHA}" "${CANDIDATE_TREE_SHA}" > "${ARTIFACT_ROOT}/candidate-metadata.json"
echo "sync_status=ready" >> "${GITHUB_OUTPUT}"
