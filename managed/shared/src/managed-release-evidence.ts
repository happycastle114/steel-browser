import { z } from "zod"

import { DigestPinnedImageReferenceSchema } from "./coolify-browser-readback.js"
import {
  GitCommitShaSchema,
  IsoTimeSchema,
  OciDigestSchema,
  Sha256Schema,
} from "./control-plane-primitives.js"
import { withDeepFrozenOutput } from "./deep-readonly.js"
import { MANAGED_RELEASE_EVIDENCE_MODE } from "./managed-release-evidence-vocabulary.js"

export { MANAGED_RELEASE_EVIDENCE_MODE } from "./managed-release-evidence-vocabulary.js"
export type { ManagedReleaseEvidenceMode } from "./managed-release-evidence-vocabulary.js"

export const ManagedReleaseEvidenceBrowserVersionSchema = z
  .string()
  .regex(/^[0-9]+(?:\.[0-9]+){3}$/u)
  .brand("ManagedReleaseEvidenceBrowserVersion")

function generatedAtForSourceDateEpoch(value: string): string | undefined {
  const seconds = Number(value)
  if (!Number.isSafeInteger(seconds)) return undefined
  const milliseconds = seconds * 1_000
  if (!Number.isSafeInteger(milliseconds)) return undefined
  const generatedAt = new Date(milliseconds)
  return Number.isFinite(generatedAt.getTime()) ? generatedAt.toISOString() : undefined
}

export const ManagedReleaseEvidenceSourceSchema = z.object({
  managedRevision: GitCommitShaSchema,
  upstreamRevision: GitCommitShaSchema,
  sourceDateEpoch: z.string()
    .regex(/^[1-9][0-9]{0,19}$/u)
    .refine((value) => generatedAtForSourceDateEpoch(value) !== undefined)
    .brand("SourceDateEpoch"),
}).strict()

const ImageEvidenceSchema = z.object({
  ref: DigestPinnedImageReferenceSchema,
  indexDigest: OciDigestSchema,
  platformDigest: OciDigestSchema,
  configDigest: OciDigestSchema,
}).strict()

const ReleaseEvidenceBaseSchema = z.object({
  schemaVersion: z.literal(1),
  evidenceMode: z.literal(MANAGED_RELEASE_EVIDENCE_MODE.CONFIG_FILE),
  body: z.object({
    managerImage: ImageEvidenceSchema,
    workerImage: ImageEvidenceSchema,
    browserVersion: ManagedReleaseEvidenceBrowserVersionSchema,
    source: ManagedReleaseEvidenceSourceSchema,
    toolchainLockSha256: Sha256Schema,
    managerProductionAuditReceiptSha256: Sha256Schema,
    workerProductionAuditReceiptSha256: Sha256Schema,
    workerRuntimeStrategyReceiptSha256: Sha256Schema,
    generatedAt: IsoTimeSchema,
  }).strict(),
}).strict().superRefine((evidence, context) => {
  const images = [
    ["managerImage", evidence.body.managerImage],
    ["workerImage", evidence.body.workerImage],
  ] as const
  for (const [field, image] of images) {
    if (!image.ref.endsWith(`@${image.indexDigest}`)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "image reference does not bind its index digest",
        path: ["body", field, "ref"],
      })
    }
    if (new Set([image.indexDigest, image.platformDigest, image.configDigest]).size !== 3) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "image index, platform, and config digests must be distinct",
        path: ["body", field],
      })
    }
  }
  if (evidence.body.managerImage.ref === evidence.body.workerImage.ref) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "manager and worker image references must be distinct",
      path: ["body", "workerImage", "ref"],
    })
  }
  const receiptDigests = [
    evidence.body.managerProductionAuditReceiptSha256,
    evidence.body.workerProductionAuditReceiptSha256,
    evidence.body.workerRuntimeStrategyReceiptSha256,
  ]
  if (new Set(receiptDigests).size !== receiptDigests.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "target audit and runtime strategy receipt digests must be distinct",
      path: ["body"],
    })
  }
  if (evidence.body.generatedAt !== generatedAtForSourceDateEpoch(evidence.body.source.sourceDateEpoch)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "generatedAt must equal the deterministic source date epoch",
      path: ["body", "generatedAt"],
    })
  }
})

export const ManagedReleaseEvidenceSchema = withDeepFrozenOutput(ReleaseEvidenceBaseSchema)

export type ManagedReleaseEvidence = z.infer<typeof ManagedReleaseEvidenceSchema>
export type ManagedReleaseEvidenceSource = z.output<typeof ManagedReleaseEvidenceSourceSchema>

export function parseManagedReleaseEvidence(input: unknown): ManagedReleaseEvidence {
  return ManagedReleaseEvidenceSchema.parse(input)
}
