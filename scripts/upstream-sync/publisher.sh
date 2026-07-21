#!/usr/bin/env bash
set -euo pipefail
REQUIRED_CHECK_CONTEXT="$(jq -er '.context | strings | select(length > 0)' .github/managed-required-check.json)"
REQUIRED_CHECK_REGISTRATION_ATTEMPTS=30
REQUIRED_CHECK_REGISTRATION_DELAY_SECONDS=2

wait_for_required_check() {
  local pr_number="$1"
  local attempt
  for ((attempt = 1; attempt <= REQUIRED_CHECK_REGISTRATION_ATTEMPTS; attempt += 1)); do
    if gh pr checks "${pr_number}" --repo "${GITHUB_REPOSITORY}" --json workflow,name --jq '.[] | "\(.workflow) / \(.name)"' 2>/dev/null | grep -Fxq -- "${REQUIRED_CHECK_CONTEXT}"; then
      return 0
    fi
    if (( attempt < REQUIRED_CHECK_REGISTRATION_ATTEMPTS )); then
      sleep "${REQUIRED_CHECK_REGISTRATION_DELAY_SECONDS}"
    fi
  done
  return 1
}

META_SOURCE_SHA="$(jq -r '.sourceSha' sync-artifact/candidate-metadata.json)"
META_MANAGED_SHA="$(jq -r '.managedSha' sync-artifact/candidate-metadata.json)"
META_STATUS="$(jq -r '.status' sync-artifact/candidate-metadata.json)"
META_BRANCH="$(jq -r '.syncBranch // empty' sync-artifact/candidate-metadata.json)"
META_MERGE_SHA="$(jq -r '.mergeCommitSha // empty' sync-artifact/candidate-metadata.json)"
META_COMMIT_SHA="$(jq -r '.candidateCommitSha // empty' sync-artifact/candidate-metadata.json)"
META_TREE_SHA="$(jq -r '.candidateTreeSha // empty' sync-artifact/candidate-metadata.json)"
META_CAPTURE_BINDING_SHA256="$(jq -r '.captureBindingSha256 // empty' sync-artifact/candidate-metadata.json)"
for value in "${META_SOURCE_SHA}" "${META_MANAGED_SHA}"; do
  [[ "${value}" =~ ^[0-9a-f]{40}$ ]] || { echo "candidate metadata SHA is invalid" >&2; exit 1; }
done
[[ "${META_STATUS}" == "READY" || "${META_STATUS}" == "NO_CHANGE" ]] || { echo "candidate metadata is not publishable" >&2; exit 1; }
if [[ "${META_STATUS}" == "READY" ]]; then
  [[ "${META_BRANCH}" =~ ^upstream-sync/[0-9a-f]{12}$ ]] || { echo "candidate branch metadata is invalid" >&2; exit 1; }
  [[ "${META_CAPTURE_BINDING_SHA256}" =~ ^[0-9a-f]{64}$ ]] || { echo "capture binding metadata digest is invalid" >&2; exit 1; }
  [[ "${EXPECTED_CAPTURE_BINDING_SHA256:-}" == "${META_CAPTURE_BINDING_SHA256}" ]] || { echo "platform-anchored capture binding digest drift" >&2; exit 1; }
  [[ "$(shasum -a 256 trusted-capture/capture-binding.json | awk '{print $1}')" == "${META_CAPTURE_BINDING_SHA256}" ]] || { echo "downloaded immutable capture binding digest drift" >&2; exit 1; }
fi
git remote add upstream "${UPSTREAM_URL}"
UPSTREAM_DEFAULT_BRANCH="$(git ls-remote --symref "${UPSTREAM_URL}" HEAD | awk '$1 == "ref:" && $2 ~ /^refs\/heads\// {sub(/^refs\/heads\//, "", $2); print $2; exit}')"
[[ "${UPSTREAM_DEFAULT_BRANCH}" =~ ^[A-Za-z0-9._/-]+$ ]] && git check-ref-format "refs/heads/${UPSTREAM_DEFAULT_BRANCH}" || { echo "upstream default branch could not be resolved safely" >&2; exit 1; }
git -c "http.extraheader=AUTHORIZATION: bearer ${PUBLISH_TOKEN}" fetch --no-tags origin "${MANAGED_BRANCH}" "${MIRROR_BRANCH}"
git fetch --no-tags upstream "${UPSTREAM_DEFAULT_BRANCH}"
[[ "$(git rev-parse "refs/remotes/upstream/${UPSTREAM_DEFAULT_BRANCH}")" == "${META_SOURCE_SHA}" ]] || { echo "upstream advanced after candidate checks; refusing stale publication" >&2; exit 1; }
[[ "$(git rev-parse "refs/remotes/origin/${MANAGED_BRANCH}")" == "${META_MANAGED_SHA}" ]] || { echo "managed advanced after candidate checks; refusing publication" >&2; exit 1; }
SOURCE_SHA="${META_SOURCE_SHA}"
MANAGED_SHA="${META_MANAGED_SHA}"
SYNC_BRANCH="${META_BRANCH:-upstream-sync/${SOURCE_SHA:0:12}}"

verify_capture_binding() {
  node scripts/upstream-sync/verify-capture-binding.mjs \
    --repository-root "${PWD}" \
    --commit-sha "$1" \
    --source-sha "${SOURCE_SHA}" \
    --binding "$2"
}

node scripts/upstream-sync/verify-repository-rules.mjs --repository "${GITHUB_REPOSITORY}"

if [[ "${META_STATUS}" == "NO_CHANGE" ]]; then
  MIRROR_SHA="$(git rev-parse "refs/remotes/origin/${MIRROR_BRANCH}")"
  git merge-base --is-ancestor "${MIRROR_SHA}" "${SOURCE_SHA}" || { echo "protected main mirror would require a non-fast-forward update" >&2; exit 1; }
  git -c "http.extraheader=AUTHORIZATION: bearer ${PUBLISH_TOKEN}" push origin "${SOURCE_SHA}:refs/heads/${MIRROR_BRANCH}"
  echo "UPSTREAM_SYNC_NO_CHANGE source_sha=${SOURCE_SHA} mirror=${MIRROR_BRANCH}"
  exit 0
fi

git bundle verify sync-artifact/candidate.bundle
git fetch sync-artifact/candidate.bundle "refs/heads/${SYNC_BRANCH}:refs/remotes/bundle/${SYNC_BRANCH}"
BUNDLE_TIP="$(git rev-parse "refs/remotes/bundle/${SYNC_BRANCH}")"
[[ "${BUNDLE_TIP}" == "${META_COMMIT_SHA}" ]] || { echo "candidate bundle tip does not match metadata" >&2; exit 1; }
[[ "${META_MERGE_SHA}" =~ ^[0-9a-f]{40}$ && "${META_TREE_SHA}" =~ ^[0-9a-f]{40}$ ]] || { echo "candidate topology metadata is invalid" >&2; exit 1; }
node scripts/upstream-sync/verify-candidate-commit.mjs \
  --commit-sha "${BUNDLE_TIP}" \
  --merge-commit-sha "${META_MERGE_SHA}" \
  --managed-sha "${MANAGED_SHA}" \
  --source-sha "${SOURCE_SHA}" \
  --tree-sha "${META_TREE_SHA}" \
  --allow-untracked-prefix "sync-artifact/"
verify_capture_binding "${BUNDLE_TIP}" "trusted-capture/capture-binding.json"

EXISTING_TIP="$(git -c "http.extraheader=AUTHORIZATION: bearer ${PUBLISH_TOKEN}" ls-remote origin "refs/heads/${SYNC_BRANCH}" | awk '{print $1; exit}')"
CLASSIFICATION_PATH="sync-artifact/classification.json"
PUBLICATION_MODE="CREATED_IMMUTABLE_CANDIDATE"
if [[ -n "${EXISTING_TIP}" ]]; then
  git -c "http.extraheader=AUTHORIZATION: bearer ${PUBLISH_TOKEN}" fetch origin "${SYNC_BRANCH}"
  EXISTING_CAPTURE_BINDING="sync-artifact/existing-capture-binding.json"
  CLASSIFICATION_PATH="sync-artifact/existing-classification.json"
  if node scripts/upstream-sync/verify-existing-candidate.mjs \
    --repository-root "${PWD}" \
    --commit-sha "${EXISTING_TIP}" \
    --managed-sha "${MANAGED_SHA}" \
    --source-sha "${SOURCE_SHA}" \
    --binding-output "${EXISTING_CAPTURE_BINDING}" \
    --classification-output "${CLASSIFICATION_PATH}"; then
    PUBLISHED_TIP="${EXISTING_TIP}"
    PUBLICATION_MODE="REUSED_VERIFIED_IMMUTABLE_CANDIDATE"
  else
    echo "immutable candidate branch exists but failed independent source/topology/corpus verification" >&2
    exit 1
  fi
else
  git -c "http.extraheader=AUTHORIZATION: bearer ${PUBLISH_TOKEN}" push origin "${BUNDLE_TIP}:refs/heads/${SYNC_BRANCH}"
  PUBLISHED_TIP="${BUNDLE_TIP}"
fi

CURRENT_MANAGED_SHA="$(git -c "http.extraheader=AUTHORIZATION: bearer ${PUBLISH_TOKEN}" ls-remote origin "refs/heads/${MANAGED_BRANCH}" | awk '{print $1; exit}')"
[[ "${CURRENT_MANAGED_SHA}" == "${MANAGED_SHA}" ]] || { echo "managed advanced before PR publication; refusing stale PR" >&2; exit 1; }
git -c "http.extraheader=AUTHORIZATION: bearer ${PUBLISH_TOKEN}" push origin "${SOURCE_SHA}:refs/heads/${MIRROR_BRANCH}"

PR_TITLE="chore(upstream): sync ${SOURCE_SHA}"
CLASSIFICATION_CATEGORIES="$(jq -ce '.categories | if type == "array" then . else error("categories must be an array") end' "${CLASSIFICATION_PATH}")"
BLOCKED_REASONS="$(jq -ce '.blockedReasons | if type == "array" then . else error("blockedReasons must be an array") end' "${CLASSIFICATION_PATH}")"
UPSTREAM_COMMITS="$(jq -ce '.upstreamTraceability.commits | if type == "array" then . else error("upstream commits must be an array") end' "${CLASSIFICATION_PATH}")"
RELEASE_NOTES="$(jq -ce '.upstreamTraceability.releaseNotes | if type == "object" then . else error("release notes traceability must be an object") end' "${CLASSIFICATION_PATH}")"
MIGRATION_NOTES="$(jq -ce '.upstreamTraceability.migrationNotes | if type == "object" then . else error("migration notes traceability must be an object") end' "${CLASSIFICATION_PATH}")"
GENERATED_ARTIFACT_STATUS="$(jq -nce --arg status "${PUBLICATION_MODE}" --arg sourceSha "${SOURCE_SHA}" --arg candidateCommit "${PUBLISHED_TIP}" '{status:$status,sourceSha:$sourceSha,candidateCommit:$candidateCommit}')"
RUN_URL="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
CANDIDATE_EVIDENCE_ARTIFACT_NAME="steel-upstream-sync-${SOURCE_SHA}"
CAPTURE_ARTIFACT_NAME="steel-upstream-capture-${SOURCE_SHA}-${META_CAPTURE_BINDING_SHA256}"
CAPTURE_ARTIFACT_PATH="captured/${SOURCE_SHA}"
PR_BODY="$(cat <<EOF
## Reviewed upstream sync

Source repository: [${UPSTREAM_REPOSITORY}](https://github.com/${UPSTREAM_REPOSITORY})
Default branch: \`${UPSTREAM_DEFAULT_BRANCH}\`
Source SHA: \`${SOURCE_SHA}\`
Managed base SHA: \`${MANAGED_SHA}\`
Mirror branch: \`${MIRROR_BRANCH}\`
Candidate branch: \`${SYNC_BRANCH}\`
Candidate commit: \`${PUBLISHED_TIP}\`
Target branch: \`${MANAGED_BRANCH}\`

The candidate job ran with contents-read permission, no persisted checkout token,
and no publisher credentials. The publisher imported an exact bundle and verified
the merge parents, generated commit tree, lock/corpus/receipt paths, current managed
base, repository ruleset preflight, and fast-forward-only mirror before opening this PR.

Classification: ${CLASSIFICATION_CATEGORIES}
Blocked reasons: ${BLOCKED_REASONS}
Upstream source-range commits: ${UPSTREAM_COMMITS}
Release-note evidence: ${RELEASE_NOTES}
Migration-note evidence: ${MIGRATION_NOTES}
Generated artifacts: ${GENERATED_ARTIFACT_STATUS}
Workflow run: ${RUN_URL}
Candidate evidence artifact: \`${CANDIDATE_EVIDENCE_ARTIFACT_NAME}\` (key paths: \`candidate.bundle\`, \`candidate-metadata.json\`, \`classification.json\`)
Immutable runtime capture artifact: \`${CAPTURE_ARTIFACT_NAME}\`
Runtime capture path: \`${CAPTURE_ARTIFACT_PATH}\`
Capture binding: \`capture-binding.json\` (SHA-256 \`${META_CAPTURE_BINDING_SHA256}\`)

Migration impact is represented by the exact source-range migration-note evidence above; \`NOT_FOUND\`
means no release or migration note path existed in that range. Before merge, rollback is closing this
candidate PR; after merge, rollback is a normal revert of its merge commit. The protected managed branch
is never written by this workflow. The mirror is fast-forward-only and is not a rollback mechanism.

Checks run before publication:
- direct reviewed \`UPSTREAM_CORPUS\` gate
- direct reviewed \`MANAGED\` typecheck/test gate
- direct reviewed \`ROOT_TEST\` gate
- direct reviewed \`ROOT_BUILD\` gate
- direct reviewed \`RAW_STATE\` gate
- Apache-2.0 license policy
- upstream-sync workflow contract tests
- GitHub ruleset preflight for managed required checks and immutable upstream-sync refs

No automatic merge, release, deploy, force push, rebase, or workflow self-modification is permitted.
EOF
)"
PR_NUMBER="$(gh pr list --repo "${GITHUB_REPOSITORY}" --state open --base "${MANAGED_BRANCH}" --head "${GITHUB_REPOSITORY_OWNER}:${SYNC_BRANCH}" --json number --jq '.[0].number // empty')"
if [[ -n "${PR_NUMBER}" ]]; then
  gh pr edit "${PR_NUMBER}" --repo "${GITHUB_REPOSITORY}" --title "${PR_TITLE}" --body "${PR_BODY}"
  echo "UPSTREAM_SYNC_PR_UPDATED source_sha=${SOURCE_SHA} pr=${PR_NUMBER}"
else
  gh pr create --repo "${GITHUB_REPOSITORY}" --base "${MANAGED_BRANCH}" --head "${GITHUB_REPOSITORY_OWNER}:${SYNC_BRANCH}" --title "${PR_TITLE}" --body "${PR_BODY}"
  echo "UPSTREAM_SYNC_PR_CREATED source_sha=${SOURCE_SHA}"
fi
PR_NUMBER="$(gh pr list --repo "${GITHUB_REPOSITORY}" --state open --base "${MANAGED_BRANCH}" --head "${GITHUB_REPOSITORY_OWNER}:${SYNC_BRANCH}" --json number --jq '.[0].number // empty')"
[[ -n "${PR_NUMBER}" ]] || { echo "managed pull request could not be read back" >&2; exit 1; }
wait_for_required_check "${PR_NUMBER}" || { echo "required managed PR check did not register within the bounded wait" >&2; exit 1; }
gh pr checks "${PR_NUMBER}" --repo "${GITHUB_REPOSITORY}" --required --watch --fail-fast
