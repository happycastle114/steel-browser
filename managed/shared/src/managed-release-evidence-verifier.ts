import { isUtf8 } from "node:buffer"
import { createHash } from "node:crypto"
import { isDeepStrictEqual } from "node:util"

import { z } from "zod"

import { canonicalJson } from "./canonical-json.js"
import { Sha256Schema } from "./control-plane-primitives.js"
import { DigestPinnedImageReferenceSchema } from "./coolify-browser-readback.js"
import {
  ManagedReleaseEvidenceBrowserVersionSchema,
  ManagedReleaseEvidenceSourceSchema,
  parseManagedReleaseEvidence,
  type ManagedReleaseEvidence,
} from "./managed-release-evidence.js"

const VerificationExpectedSchema = z.object({
  releaseEvidenceSha256: Sha256Schema,
  managerImageRef: DigestPinnedImageReferenceSchema,
  workerImageRef: DigestPinnedImageReferenceSchema,
  browserVersion: ManagedReleaseEvidenceBrowserVersionSchema,
  source: ManagedReleaseEvidenceSourceSchema,
  toolchainLockSha256: Sha256Schema,
  managerProductionAuditReceiptSha256: Sha256Schema,
  workerProductionAuditReceiptSha256: Sha256Schema,
  workerRuntimeStrategyReceiptSha256: Sha256Schema,
}).strict()

export const MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD = {
  RELEASE_EVIDENCE_SHA256: "RELEASE_EVIDENCE_SHA256",
  CANONICAL_BYTES: "CANONICAL_BYTES",
  MANAGER_IMAGE_REF: "MANAGER_IMAGE_REF",
  WORKER_IMAGE_REF: "WORKER_IMAGE_REF",
  BROWSER_VERSION: "BROWSER_VERSION",
  SOURCE: "SOURCE",
  TOOLCHAIN_LOCK_SHA256: "TOOLCHAIN_LOCK_SHA256",
  MANAGER_PRODUCTION_AUDIT_RECEIPT_SHA256: "MANAGER_PRODUCTION_AUDIT_RECEIPT_SHA256",
  WORKER_PRODUCTION_AUDIT_RECEIPT_SHA256: "WORKER_PRODUCTION_AUDIT_RECEIPT_SHA256",
  WORKER_RUNTIME_STRATEGY_RECEIPT_SHA256: "WORKER_RUNTIME_STRATEGY_RECEIPT_SHA256",
} as const

export type ManagedReleaseEvidenceMismatchField =
  (typeof MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD)[keyof typeof MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD]
export type ManagedReleaseEvidenceVerificationExpected = z.output<typeof VerificationExpectedSchema>
export type ManagedReleaseEvidenceVerificationExpectedInput = z.input<typeof VerificationExpectedSchema>

export class ManagedReleaseEvidenceMismatchError extends Error {
  public override readonly name = "ManagedReleaseEvidenceMismatchError"

  public constructor(public readonly field: ManagedReleaseEvidenceMismatchField) {
    super(`Managed release evidence mismatch: ${field}`)
  }
}

export function verifyManagedReleaseEvidenceBytes(
  rawBytes: string | Uint8Array,
  expectedInput: ManagedReleaseEvidenceVerificationExpectedInput,
): ManagedReleaseEvidence {
  const expected = VerificationExpectedSchema.parse(expectedInput)
  const bytes = typeof rawBytes === "string" ? Buffer.from(rawBytes, "utf8") : Buffer.from(rawBytes)
  const actualSha256 = createHash("sha256").update(bytes).digest("hex")
  if (actualSha256 !== expected.releaseEvidenceSha256) {
    throw new ManagedReleaseEvidenceMismatchError(
      MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD.RELEASE_EVIDENCE_SHA256,
    )
  }
  if (!isUtf8(bytes)) {
    throw new ManagedReleaseEvidenceMismatchError(MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD.CANONICAL_BYTES)
  }

  const text = bytes.toString("utf8")
  if (!text.startsWith("{") || !text.endsWith("\n") || text.endsWith("\n\n")) {
    throw new ManagedReleaseEvidenceMismatchError(MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD.CANONICAL_BYTES)
  }

  let input: unknown
  try {
    input = JSON.parse(text)
  } catch {
    throw new ManagedReleaseEvidenceMismatchError(MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD.CANONICAL_BYTES)
  }
  const evidence = parseManagedReleaseEvidence(input)
  const canonicalBytes = Buffer.from(`${canonicalJson(evidence)}\n`, "utf8")
  if (!bytes.equals(canonicalBytes)) {
    throw new ManagedReleaseEvidenceMismatchError(MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD.CANONICAL_BYTES)
  }
  if (evidence.body.managerImage.ref !== expected.managerImageRef) {
    throw new ManagedReleaseEvidenceMismatchError(MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD.MANAGER_IMAGE_REF)
  }
  if (evidence.body.workerImage.ref !== expected.workerImageRef) {
    throw new ManagedReleaseEvidenceMismatchError(MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD.WORKER_IMAGE_REF)
  }
  if (evidence.body.browserVersion !== expected.browserVersion) {
    throw new ManagedReleaseEvidenceMismatchError(MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD.BROWSER_VERSION)
  }
  if (!isDeepStrictEqual(evidence.body.source, expected.source)) {
    throw new ManagedReleaseEvidenceMismatchError(MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD.SOURCE)
  }
  if (evidence.body.toolchainLockSha256 !== expected.toolchainLockSha256) {
    throw new ManagedReleaseEvidenceMismatchError(MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD.TOOLCHAIN_LOCK_SHA256)
  }
  if (evidence.body.managerProductionAuditReceiptSha256 !== expected.managerProductionAuditReceiptSha256) {
    throw new ManagedReleaseEvidenceMismatchError(
      MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD.MANAGER_PRODUCTION_AUDIT_RECEIPT_SHA256,
    )
  }
  if (evidence.body.workerProductionAuditReceiptSha256 !== expected.workerProductionAuditReceiptSha256) {
    throw new ManagedReleaseEvidenceMismatchError(
      MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD.WORKER_PRODUCTION_AUDIT_RECEIPT_SHA256,
    )
  }
  if (evidence.body.workerRuntimeStrategyReceiptSha256 !== expected.workerRuntimeStrategyReceiptSha256) {
    throw new ManagedReleaseEvidenceMismatchError(
      MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD.WORKER_RUNTIME_STRATEGY_RECEIPT_SHA256,
    )
  }
  return evidence
}
