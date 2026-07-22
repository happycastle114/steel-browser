export const REPRODUCIBLE_BUILD_BOUNDARY = {
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
  TWO_ATTEMPTS: 'first="$(build_once first)"\nsecond="$(build_once second)"',
  REPRODUCIBLE_PLATFORM: 'test "${first_platform_digest}" = "${second_platform_digest}"',
  REPRODUCIBLE_CONFIG: 'test "${first_config_digest}" = "${second_config_digest}"',
  AUDIT_EXPORT_TARGET: "--target production-audit-export",
  AUDIT_OUTPUT: "type=local,dest=${production_audit_dir}",
  AUDIT_RECEIPT_SHA:
    "production_audit_receipt_sha256=\"$(sha256sum \"${production_audit_receipt}\" | cut -d ' ' -f 1)\"",
  AUDIT_CONTEXT: "--build-context \"production-audit-input=${production_audit_dir}\"",
  AUDIT_BUILD_ARGUMENT:
    "--build-arg \"MANAGED_PRODUCTION_AUDIT_RECEIPT_SHA256=${production_audit_receipt_sha256}\"",
  SOURCE_EPOCH_BUILD_ARGUMENT:
    '--build-arg "SOURCE_DATE_EPOCH=${source_date_epoch}"',
  RUNTIME_RECEIPT_FIELD:
    "productionAuditReceiptSha256:$productionAuditReceiptSha256",
} as const

export class ReproducibleBuildPolicyError extends Error {
  override readonly name = "ReproducibleBuildPolicyError"
}

export function verifyReproducibleBuildScript(source: string): void {
  for (const [name, boundary] of Object.entries(REPRODUCIBLE_BUILD_BOUNDARY)) {
    if (name === "GIT_ARCHIVE" && source.split(boundary).length - 1 !== 2) {
      throw new ReproducibleBuildPolicyError("reproducible build does not use isolated git archives")
    }
    if (!source.includes(boundary)) {
      throw new ReproducibleBuildPolicyError(
        "reproducible build does not bind the production audit receipt",
      )
    }
  }
  if (
    source.split(REPRODUCIBLE_BUILD_BOUNDARY.SOURCE_EPOCH_BUILD_ARGUMENT)
      .length -
      1 !==
    2
  ) {
    throw new ReproducibleBuildPolicyError(
      "audit and image builds must share the source epoch",
    )
  }
}
