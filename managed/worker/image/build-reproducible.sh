#!/usr/bin/env bash
set -euo pipefail

source_revision="${MANAGED_SOURCE_REVISION:?MANAGED_SOURCE_REVISION is required}"
candidate_repository="${MANAGED_CANDIDATE_REPOSITORY:?MANAGED_CANDIDATE_REPOSITORY is required}"
receipt_path="${MANAGED_RUNTIME_STRATEGY_RECEIPT:?MANAGED_RUNTIME_STRATEGY_RECEIPT is required}"
production_audit_receipt_path="${MANAGED_PRODUCTION_AUDIT_RECEIPT:?MANAGED_PRODUCTION_AUDIT_RECEIPT is required}"
build_run_id="${MANAGED_BUILD_RUN_ID:?MANAGED_BUILD_RUN_ID is required}"
platform="${MANAGED_IMAGE_PLATFORM:-linux/amd64}"

case "${source_revision}" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *) exit 64 ;;
esac

if [[ ! "${candidate_repository}" =~ ^[a-z0-9][a-z0-9._/-]*$ ]]; then
  exit 64
fi
if [[ ! "${build_run_id}" =~ ^[a-z0-9][a-z0-9.-]{0,62}$ ]]; then
  exit 64
fi
case "${platform}" in
  linux/amd64) architecture="amd64" ;;
  linux/arm64) architecture="arm64" ;;
  *) exit 64 ;;
esac

test "$(git rev-parse HEAD)" = "${source_revision}"
git diff --quiet --ignore-submodules --
git diff --cached --quiet --ignore-submodules --

source_date_epoch="$(git show -s --format=%ct "${source_revision}")"
source_tree_sha256="$(git archive --format=tar "${source_revision}" | sha256sum | cut -d ' ' -f 1)"
audit_observed_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
build_root="$(mktemp -d)"
trap 'rm -rf "${build_root}"' EXIT

production_audit_dir="${build_root}/production-audit"
git archive --format=tar "${source_revision}" | docker buildx build \
  --file managed/worker/image/Dockerfile \
  --target production-audit-export \
  --platform "${platform}" \
  --build-arg "MANAGED_AUDIT_OBSERVED_AT=${audit_observed_at}" \
  --build-arg "MANAGED_SOURCE_REVISION=${source_revision}" \
  --build-arg "MANAGED_SOURCE_TREE_SHA256=${source_tree_sha256}" \
  --build-arg "SOURCE_DATE_EPOCH=${source_date_epoch}" \
  --no-cache \
  --output "type=local,dest=${production_audit_dir}" \
  -
production_audit_receipt="${production_audit_dir}/production-dependency-audit.json"
test -s "${production_audit_receipt}"
production_audit_receipt_sha256="$(sha256sum "${production_audit_receipt}" | cut -d ' ' -f 1)"
cp "${production_audit_receipt}" "${production_audit_receipt_path}"

build_once() {
  local attempt="$1"
  local metadata="${build_root}/worker-${attempt}.metadata.json"
  local tag="${candidate_repository}:source-${source_revision}-${build_run_id}-${attempt}"
  git archive --format=tar "${source_revision}" | docker buildx build \
    --file managed/worker/image/Dockerfile \
    --platform "${platform}" \
    --build-context "production-audit-input=${production_audit_dir}" \
    --build-arg "MANAGED_PRODUCTION_AUDIT_RECEIPT_SHA256=${production_audit_receipt_sha256}" \
    --build-arg "MANAGED_SOURCE_REVISION=${source_revision}" \
    --build-arg "SOURCE_DATE_EPOCH=${source_date_epoch}" \
    --no-cache \
    --provenance=mode=min \
    --sbom=true \
    --metadata-file "${metadata}" \
    --output "type=image,name=${tag},push=true,oci-mediatypes=true,rewrite-timestamp=true" \
    -
  local index_digest
  index_digest="$(jq -er '."containerimage.digest"' "${metadata}")"
  local index_manifest="${build_root}/worker-${attempt}.index.json"
  docker buildx imagetools inspect --raw "${candidate_repository}@${index_digest}" > "${index_manifest}"
  test "$(docker buildx imagetools inspect "${candidate_repository}@${index_digest}" --format '{{json .Manifest}}' | jq -er '.digest')" = "${index_digest}"
  local platform_digest
  platform_digest="$(jq -er --arg architecture "${architecture}" '.manifests[] | select(.platform.os == "linux" and .platform.architecture == $architecture) | .digest' "${index_manifest}")"
  test "$(jq -r --arg architecture "${architecture}" '[.manifests[] | select(.platform.os == "linux" and .platform.architecture == $architecture)] | length' "${index_manifest}")" = "1"
  local attestation_manifest="${build_root}/worker-${attempt}.attestations.json"
  jq -c --arg subject "${platform_digest}" '[.manifests[] | select(.platform.os == "unknown" and .annotations["vnd.docker.reference.type"] == "attestation-manifest" and .annotations["vnd.docker.reference.digest"] == $subject) | .digest] | if length > 0 and length == (unique | length) then . else error("missing or duplicate attestation descriptor") end' "${index_manifest}" > "${attestation_manifest}"
  local attestation_predicates="${build_root}/worker-${attempt}.predicates.ndjson"
  while read -r attestation_digest; do
    local attestation="${build_root}/worker-${attempt}-${attestation_digest#sha256:}.json"
    docker buildx imagetools inspect --raw "${candidate_repository}@${attestation_digest}" > "${attestation}"
    test "$(docker buildx imagetools inspect "${candidate_repository}@${attestation_digest}" --format '{{json .Manifest}}' | jq -er '.digest')" = "${attestation_digest}"
    jq -c '.layers[].annotations["in-toto.io/predicate-type"] // empty' "${attestation}" >> "${attestation_predicates}"
  done < <(jq -r '.[]' "${attestation_manifest}")
  jq -se 'any(.[]; startswith("https://slsa.dev/provenance/")) and any(.[]; . == "https://spdx.dev/Document")' "${attestation_predicates}" > /dev/null
  local platform_manifest="${build_root}/worker-${attempt}.platform.json"
  docker buildx imagetools inspect --raw "${candidate_repository}@${platform_digest}" > "${platform_manifest}"
  test "$(docker buildx imagetools inspect "${candidate_repository}@${platform_digest}" --format '{{json .Manifest}}' | jq -er '.digest')" = "${platform_digest}"
  local config_digest
  config_digest="$(jq -er '.config.digest' "${platform_manifest}")"
  test "${config_digest}" = "$(jq -er '."containerimage.config.digest"' "${metadata}")"
  local labels
  labels="$(docker buildx imagetools inspect "${candidate_repository}@${platform_digest}" --format '{{json .Image.Config.Labels}}')"
  test "$(jq -r '."org.opencontainers.image.revision"' <<< "${labels}")" = "${source_revision}"
  test "$(jq -r '."dev.happycastle.steel.source-date-epoch"' <<< "${labels}")" = "${source_date_epoch}"
  test "$(jq -r '."dev.happycastle.steel.upstream.revision"' <<< "${labels}")" = "c0f226b8e3b16d0bc2c76a222863d4db6f1aa8f2"
  test "$(jq -r '."dev.happycastle.steel.production-audit.sha256"' <<< "${labels}")" = "${production_audit_receipt_sha256}"
  jq -n \
    --arg configDigest "${config_digest}" \
    --arg indexDigest "${index_digest}" \
    --arg platformDigest "${platform_digest}" \
    --slurpfile attestationDigests "${attestation_manifest}" \
    '{configDigest:$configDigest,indexDigest:$indexDigest,platformDigest:$platformDigest,attestationDigests:$attestationDigests[0]}'
}

first="$(build_once first)"
second="$(build_once second)"
first_platform_digest="$(jq -r '.platformDigest' <<< "${first}")"
second_platform_digest="$(jq -r '.platformDigest' <<< "${second}")"
test "${first_platform_digest}" = "${second_platform_digest}"
first_config_digest="$(jq -r '.configDigest' <<< "${first}")"
second_config_digest="$(jq -r '.configDigest' <<< "${second}")"
test "${first_config_digest}" = "${second_config_digest}"
candidate_index_digest="$(jq -r '.indexDigest' <<< "${second}")"

jq -n \
  --argjson attestationDigests "$(jq -c '.attestationDigests' <<< "${second}")" \
  --arg baseImage "ghcr.io/steel-dev/steel-browser@sha256:1c988dc8a8eda687648d1c94e10e8b8627343977119f09aa34a6adf345ba104d" \
  --arg candidateConfigDigest "${second_config_digest}" \
  --arg candidateImage "${candidate_repository}@${candidate_index_digest}" \
  --arg candidateIndexDigest "${candidate_index_digest}" \
  --arg candidatePlatformDigest "${second_platform_digest}" \
  --arg firstDigest "${first_platform_digest}" \
  --arg secondDigest "${second_platform_digest}" \
  --arg platform "${platform}" \
  --arg productionAuditReceiptSha256 "${production_audit_receipt_sha256}" \
  --arg sourceDateEpoch "${source_date_epoch}" \
  --arg sourceRevision "${source_revision}" \
  '{schemaVersion:1,strategy:"UPSTREAM_COMBINED",baseImage:$baseImage,buildContextMethod:"GIT_ARCHIVE",buildDigests:[$firstDigest,$secondDigest],candidateImage:$candidateImage,candidateIndexDigest:$candidateIndexDigest,candidatePlatformDigest:$candidatePlatformDigest,candidateConfigDigest:$candidateConfigDigest,attestationDigests:$attestationDigests,productionAuditReceiptSha256:$productionAuditReceiptSha256,registryReadbackVerified:true,sourceLabelsVerified:true,platform:$platform,sourceDateEpoch:$sourceDateEpoch,sourceRevision:$sourceRevision}' \
  > "${receipt_path}"
