export const MANAGER_REPRODUCIBLE_BUILD_BOUNDARY = {
  FAIL_CLOSED_SUBSHELL: "shopt -s inherit_errexit",
  CLEAN_INDEX: "git diff --cached --quiet --ignore-submodules --",
  CLEAN_WORKTREE: "git diff --quiet --ignore-submodules --",
  GIT_ARCHIVE: 'git archive --format=tar "${source_revision}" | docker buildx build',
  ATTEMPT_TAG: 'local tag="${candidate_repository}:source-${source_revision}-${build_run_id}-${attempt}"',
  PUSHED_OCI_IMAGE: '--output "type=image,name=${tag},push=true,oci-mediatypes=true,rewrite-timestamp=true"',
  INDEX_READBACK: 'docker buildx imagetools inspect --raw "${candidate_repository}@${index_digest}"',
  PLATFORM_READBACK: 'docker buildx imagetools inspect --raw "${candidate_repository}@${platform_digest}"',
  CONFIG_BINDING: 'test "${config_digest}" = "$(jq -er \'."containerimage.config.digest"\' "${metadata}")"',
  SOURCE_REVISION_LABEL: 'test "$(jq -r \'."org.opencontainers.image.revision"\' <<< "${labels}")" = "${source_revision}"',
  SOURCE_EPOCH_LABEL: 'test "$(jq -r \'."dev.happycastle.steel.source-date-epoch"\' <<< "${labels}")" = "${source_date_epoch}"',
  AUDIT_LABEL: 'test "$(jq -r \'."dev.happycastle.steel.production-audit.sha256"\' <<< "${labels}")" = "${production_audit_receipt_sha256}"',
  AUDIT_EXPORT_TARGET: "--target production-audit-export",
  AUDIT_OUTPUT: "type=local,dest=${production_audit_dir}",
  AUDIT_CONTEXT: '--build-context "production-audit-input=${production_audit_dir}"',
  AUDIT_BUILD_ARGUMENT: '--build-arg "MANAGED_PRODUCTION_AUDIT_RECEIPT_SHA256=${production_audit_receipt_sha256}"',
  SOURCE_EPOCH_BUILD_ARGUMENT: '--build-arg "SOURCE_DATE_EPOCH=${source_date_epoch}"',
  TWO_ATTEMPTS: 'first="$(build_once first)"\nsecond="$(build_once second)"',
  REPRODUCIBLE_PLATFORM: 'test "${first_platform_digest}" = "${second_platform_digest}"',
  REPRODUCIBLE_CONFIG: 'test "${first_config_digest}" = "${second_config_digest}"',
  RECEIPT_AUDIT_FIELD: 'productionAuditReceiptSha256:$productionAuditReceiptSha256',
} as const

export class ManagerReproducibleBuildPolicyError extends Error {
  public override readonly name = "ManagerReproducibleBuildPolicyError"
}

export function verifyManagerReproducibleBuildScript(source: string): void {
  for (const boundary of Object.values(MANAGER_REPRODUCIBLE_BUILD_BOUNDARY)) {
    if (!source.includes(boundary)) {
      throw new ManagerReproducibleBuildPolicyError(
        "manager reproducible build boundary missing",
      )
    }
  }
  if (
    source.split(MANAGER_REPRODUCIBLE_BUILD_BOUNDARY.GIT_ARCHIVE).length - 1 !== 2
  ) {
    throw new ManagerReproducibleBuildPolicyError(
      "manager build must use isolated Git archives",
    )
  }
  if (
    source.split(MANAGER_REPRODUCIBLE_BUILD_BOUNDARY.SOURCE_EPOCH_BUILD_ARGUMENT)
      .length -
      1 !==
    2
  ) {
    throw new ManagerReproducibleBuildPolicyError(
      "manager audit and image builds must share the source epoch",
    )
  }
}
