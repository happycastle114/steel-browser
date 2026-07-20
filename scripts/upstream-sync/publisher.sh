#!/usr/bin/env bash
set -euo pipefail
META_SOURCE_SHA="$(jq -r '.sourceSha' sync-artifact/candidate-metadata.json)"
META_MANAGED_SHA="$(jq -r '.managedSha' sync-artifact/candidate-metadata.json)"
META_STATUS="$(jq -r '.status' sync-artifact/candidate-metadata.json)"
META_BRANCH="$(jq -r '.syncBranch // empty' sync-artifact/candidate-metadata.json)"
META_MERGE_SHA="$(jq -r '.mergeCommitSha // empty' sync-artifact/candidate-metadata.json)"
META_COMMIT_SHA="$(jq -r '.candidateCommitSha // empty' sync-artifact/candidate-metadata.json)"
META_TREE_SHA="$(jq -r '.candidateTreeSha // empty' sync-artifact/candidate-metadata.json)"
for value in "${META_SOURCE_SHA}" "${META_MANAGED_SHA}"; do
  [[ "${value}" =~ ^[0-9a-f]{40}$ ]] || { echo "candidate metadata SHA is invalid" >&2; exit 1; }
done
[[ "${META_STATUS}" == "READY" || "${META_STATUS}" == "NO_CHANGE" ]] || { echo "candidate metadata is not publishable" >&2; exit 1; }
if [[ "${META_STATUS}" == "READY" ]]; then
  [[ "${META_BRANCH}" =~ ^upstream-sync/[0-9a-f]{40}-[0-9a-f]{40}$ ]] || { echo "candidate branch metadata is invalid" >&2; exit 1; }
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
SYNC_BRANCH="${META_BRANCH:-upstream-sync/${SOURCE_SHA}-${MANAGED_SHA}}"
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

EXISTING_TIP="$(git -c "http.extraheader=AUTHORIZATION: bearer ${PUBLISH_TOKEN}" ls-remote origin "refs/heads/${SYNC_BRANCH}" | awk '{print $1; exit}')"
if [[ -n "${EXISTING_TIP}" ]]; then
  git -c "http.extraheader=AUTHORIZATION: bearer ${PUBLISH_TOKEN}" fetch origin "${SYNC_BRANCH}"
  if node scripts/upstream-sync/verify-candidate-commit.mjs \
    --commit-sha "${EXISTING_TIP}" \
    --merge-commit-sha "${META_MERGE_SHA}" \
      --managed-sha "${MANAGED_SHA}" \
      --source-sha "${SOURCE_SHA}" \
      --tree-sha "${META_TREE_SHA}" \
      --allow-untracked-prefix "sync-artifact/"; then
    PUBLISHED_TIP="${EXISTING_TIP}"
  else
    RECOVERY_BRANCH="${META_BRANCH}-${META_COMMIT_SHA}"
    [[ "${RECOVERY_BRANCH}" =~ ^upstream-sync/[0-9a-f]{40}-[0-9a-f]{40}-[0-9a-f]{40}$ ]] || { echo "candidate recovery branch metadata is invalid" >&2; exit 1; }
    RECOVERY_TIP="$(git -c "http.extraheader=AUTHORIZATION: bearer ${PUBLISH_TOKEN}" ls-remote origin "refs/heads/${RECOVERY_BRANCH}" | awk '{print $1; exit}')"
    if [[ -n "${RECOVERY_TIP}" ]]; then
      git -c "http.extraheader=AUTHORIZATION: bearer ${PUBLISH_TOKEN}" fetch origin "${RECOVERY_BRANCH}"
      node scripts/upstream-sync/verify-candidate-commit.mjs \
        --commit-sha "${RECOVERY_TIP}" \
        --merge-commit-sha "${META_MERGE_SHA}" \
        --managed-sha "${MANAGED_SHA}" \
        --source-sha "${SOURCE_SHA}" \
        --tree-sha "${META_TREE_SHA}" \
        --allow-untracked-prefix "sync-artifact/"
      PUBLISHED_TIP="${RECOVERY_TIP}"
    else
      git -c "http.extraheader=AUTHORIZATION: bearer ${PUBLISH_TOKEN}" push origin "${BUNDLE_TIP}:refs/heads/${RECOVERY_BRANCH}"
      SYNC_BRANCH="${RECOVERY_BRANCH}"
      PUBLISHED_TIP="${BUNDLE_TIP}"
    fi
  fi
else
  git -c "http.extraheader=AUTHORIZATION: bearer ${PUBLISH_TOKEN}" push origin "${BUNDLE_TIP}:refs/heads/${SYNC_BRANCH}"
  PUBLISHED_TIP="${BUNDLE_TIP}"
fi

CURRENT_MANAGED_SHA="$(git -c "http.extraheader=AUTHORIZATION: bearer ${PUBLISH_TOKEN}" ls-remote origin "refs/heads/${MANAGED_BRANCH}" | awk '{print $1; exit}')"
[[ "${CURRENT_MANAGED_SHA}" == "${MANAGED_SHA}" ]] || { echo "managed advanced before PR publication; refusing stale PR" >&2; exit 1; }
git -c "http.extraheader=AUTHORIZATION: bearer ${PUBLISH_TOKEN}" push origin "${SOURCE_SHA}:refs/heads/${MIRROR_BRANCH}"

PR_TITLE="chore(upstream): sync ${SOURCE_SHA}"
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

Classification: \$(jq -c '.categories' sync-artifact/classification.json)
Blocked reasons: \$(jq -c '.blockedReasons' sync-artifact/classification.json)

Checks run before publication:
- \`npm run verify:upstream-corpus\`
- \`npm run check:managed\`
- \`npm run test\`
- \`npm run build\`
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
gh pr checks "${PR_NUMBER}" --repo "${GITHUB_REPOSITORY}" --watch --fail-fast
