import { createHash } from "node:crypto"

import { z } from "zod"

import {
  GitCommitShaSchema,
  OciDigestSchema,
  Sha256Schema,
} from "./control-plane-primitives.js"
import { DigestPinnedImageReferenceSchema } from "./coolify-browser-readback.js"
import { withDeepFrozenOutput } from "./deep-readonly.js"

export const RUNTIME_STRATEGY = {
  PLAYWRIGHT_BASE: "PLAYWRIGHT_BASE",
  UPSTREAM_COMBINED: "UPSTREAM_COMBINED",
} as const

export const BUILD_CONTEXT_METHOD = { GIT_ARCHIVE: "GIT_ARCHIVE" } as const
export const IMAGE_PLATFORM = {
  AMD64: "linux/amd64",
  ARM64: "linux/arm64",
} as const

export const RUNTIME_STRATEGY_MISMATCH_FIELD = {
  BASE_IMAGE: "BASE_IMAGE",
  CANDIDATE_IMAGE: "CANDIDATE_IMAGE",
  PLATFORM: "PLATFORM",
  RECEIPT_SHA256: "RECEIPT_SHA256",
  SOURCE_REVISION: "SOURCE_REVISION",
  STRATEGY: "STRATEGY",
  PRODUCTION_AUDIT_RECEIPT_SHA256: "PRODUCTION_AUDIT_RECEIPT_SHA256",
} as const

const PlatformSchema = z.enum([IMAGE_PLATFORM.AMD64, IMAGE_PLATFORM.ARM64])
const StrategySchema = z.enum([
  RUNTIME_STRATEGY.PLAYWRIGHT_BASE,
  RUNTIME_STRATEGY.UPSTREAM_COMBINED,
])

const ReceiptBaseSchema = z.object({
  schemaVersion: z.literal(1),
  strategy: StrategySchema,
  baseImage: DigestPinnedImageReferenceSchema,
  buildContextMethod: z.literal(BUILD_CONTEXT_METHOD.GIT_ARCHIVE),
  buildDigests: z.tuple([OciDigestSchema, OciDigestSchema]).readonly(),
  candidateImage: DigestPinnedImageReferenceSchema,
  candidateIndexDigest: OciDigestSchema,
  candidatePlatformDigest: OciDigestSchema,
  candidateConfigDigest: OciDigestSchema,
  attestationDigests: z.array(OciDigestSchema).min(1).max(32).readonly(),
  productionAuditReceiptSha256: Sha256Schema,
  registryReadbackVerified: z.literal(true),
  sourceLabelsVerified: z.literal(true),
  platform: PlatformSchema,
  sourceDateEpoch: z.string().regex(/^[1-9][0-9]*$/u).max(20),
  sourceRevision: GitCommitShaSchema,
}).strict().superRefine((receipt, context) => {
  const buildsAreReproducible =
    receipt.buildDigests[0] === receipt.buildDigests[1] &&
    receipt.candidatePlatformDigest === receipt.buildDigests[0]
  if (!buildsAreReproducible) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "build subjects are not reproducible", path: ["buildDigests"] })
  }
  if (!receipt.candidateImage.endsWith(`@${receipt.candidateIndexDigest}`)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "candidate image does not bind its index", path: ["candidateImage"] })
  }
  if (new Set(receipt.attestationDigests).size !== receipt.attestationDigests.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "attestation digests are duplicated", path: ["attestationDigests"] })
  }
})

export const RuntimeStrategyReceiptSchema = withDeepFrozenOutput(ReceiptBaseSchema)

const VerificationExpectedSchema = z.object({
  receiptSha256: Sha256Schema,
  sourceRevision: GitCommitShaSchema,
  upstreamCombinedBaseImage: DigestPinnedImageReferenceSchema,
  candidateImage: DigestPinnedImageReferenceSchema,
  platform: PlatformSchema,
  productionAuditReceiptSha256: Sha256Schema,
}).strict()

export type RuntimeStrategy = z.infer<typeof StrategySchema>
export type RuntimeStrategyReceipt = z.infer<typeof RuntimeStrategyReceiptSchema>
export type RuntimeStrategyVerificationExpected = z.output<typeof VerificationExpectedSchema>
export type RuntimeStrategyVerificationExpectedInput = z.input<typeof VerificationExpectedSchema>
export type RuntimeStrategyMismatchField =
  (typeof RUNTIME_STRATEGY_MISMATCH_FIELD)[keyof typeof RUNTIME_STRATEGY_MISMATCH_FIELD]

export class RuntimeStrategyReceiptError extends Error {
  override readonly name = "RuntimeStrategyReceiptError"
  public constructor(readonly field: RuntimeStrategyMismatchField) {
    super(`Runtime strategy receipt mismatch: ${field}`)
  }
}

export function parseRuntimeStrategyReceipt(input: unknown): RuntimeStrategyReceipt {
  return RuntimeStrategyReceiptSchema.parse(input)
}

export function verifyRuntimeStrategyReceipt(
  input: unknown,
  expectedInput: Omit<RuntimeStrategyVerificationExpectedInput, "receiptSha256">,
): RuntimeStrategyReceipt {
  const expected = VerificationExpectedSchema.omit({ receiptSha256: true }).parse(expectedInput)
  const receipt = parseRuntimeStrategyReceipt(input)
  if (receipt.sourceRevision !== expected.sourceRevision)
    throw new RuntimeStrategyReceiptError(RUNTIME_STRATEGY_MISMATCH_FIELD.SOURCE_REVISION)
  if (receipt.candidateImage !== expected.candidateImage)
    throw new RuntimeStrategyReceiptError(RUNTIME_STRATEGY_MISMATCH_FIELD.CANDIDATE_IMAGE)
  if (receipt.platform !== expected.platform)
    throw new RuntimeStrategyReceiptError(RUNTIME_STRATEGY_MISMATCH_FIELD.PLATFORM)
  if (receipt.productionAuditReceiptSha256 !== expected.productionAuditReceiptSha256)
    throw new RuntimeStrategyReceiptError(RUNTIME_STRATEGY_MISMATCH_FIELD.PRODUCTION_AUDIT_RECEIPT_SHA256)
  if (receipt.strategy !== RUNTIME_STRATEGY.UPSTREAM_COMBINED)
    throw new RuntimeStrategyReceiptError(RUNTIME_STRATEGY_MISMATCH_FIELD.STRATEGY)
  if (receipt.baseImage !== expected.upstreamCombinedBaseImage)
    throw new RuntimeStrategyReceiptError(RUNTIME_STRATEGY_MISMATCH_FIELD.BASE_IMAGE)
  return receipt
}

export function verifyRuntimeStrategyReceiptBytes(
  rawBytes: string | Uint8Array,
  expectedInput: RuntimeStrategyVerificationExpectedInput,
): RuntimeStrategyReceipt {
  const expected = VerificationExpectedSchema.parse(expectedInput)
  const bytes = typeof rawBytes === "string" ? Buffer.from(rawBytes, "utf8") : Buffer.from(rawBytes)
  const actualSha256 = createHash("sha256").update(bytes).digest("hex")
  if (actualSha256 !== expected.receiptSha256)
    throw new RuntimeStrategyReceiptError(RUNTIME_STRATEGY_MISMATCH_FIELD.RECEIPT_SHA256)
  const input: unknown = JSON.parse(bytes.toString("utf8"))
  return verifyRuntimeStrategyReceipt(input, {
    sourceRevision: expected.sourceRevision,
    upstreamCombinedBaseImage: expected.upstreamCombinedBaseImage,
    candidateImage: expected.candidateImage,
    platform: expected.platform,
    productionAuditReceiptSha256: expected.productionAuditReceiptSha256,
  })
}
