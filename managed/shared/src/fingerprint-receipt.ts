import { z } from "zod"

import { withDeepReadonlyOutput } from "./deep-readonly.js"
import {
  FINGERPRINT_RECEIPT_ERROR_CODE,
  FINGERPRINT_RECEIPT_KIND,
  MANAGED_SECRET_ENVIRONMENT_KEY,
  RECEIPT_SIGNATURE_ALGORITHM,
} from "./fingerprint-receipt-vocabulary.js"
import {
  COOLIFY_PRODUCTION_OWNER,
  FINGERPRINT_PROOF_LEVEL,
  MANAGED_PROJECT_RUNTIME_STATE,
} from "./deployment-vocabulary.js"
import { EXPECTED_OVERLAY_PLAN_SHA256 } from "./managed-overlay-catalog.js"
import { RUNTIME_SCOPE_POOL } from "./runtime-scope-vocabulary.js"

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u)
const UuidSchema = z.string().uuid()

const EnvironmentMetadataSchema = z
  .object({
    uuid: UuidSchema,
    key: z.literal(MANAGED_SECRET_ENVIRONMENT_KEY),
    isPreview: z.literal(false),
    isLiteral: z.literal(true),
    isMultiline: z.literal(false),
    isShownOnce: z.literal(true),
    isRuntime: z.literal(true),
    isBuildtime: z.literal(false),
  })
  .strict()

const ReceiptSignatureSchema = z
  .object({
    algorithm: z.literal(RECEIPT_SIGNATURE_ALGORITHM.HMAC_SHA256),
    keyId: Sha256Schema,
    hmacSha256: Sha256Schema,
  })
  .strict()

const configReceiptFields = {
  schemaVersion: z.literal(1),
  kind: z.literal(FINGERPRINT_RECEIPT_KIND.CONFIG_WRITE),
  proofLevel: z.literal(FINGERPRINT_PROOF_LEVEL.CONFIG_BOUND),
  applicationId: UuidSchema,
  createTokenKeyId: Sha256Schema,
  configSha256: Sha256Schema,
  fingerprintHmacSha256: Sha256Schema,
  overlayPlanSha256: z.literal(EXPECTED_OVERLAY_PLAN_SHA256),
  environment: EnvironmentMetadataSchema,
  signature: ReceiptSignatureSchema,
} as const

const BlueWriteReceiptSchema = z
  .object({
    ...configReceiptFields,
    slot: z.literal(COOLIFY_PRODUCTION_OWNER.MANAGED_BLUE),
    poolId: z.literal(RUNTIME_SCOPE_POOL.BLUE),
  })
  .strict()

const GreenWriteReceiptSchema = z
  .object({
    ...configReceiptFields,
    slot: z.literal(COOLIFY_PRODUCTION_OWNER.MANAGED_GREEN),
    poolId: z.literal(RUNTIME_SCOPE_POOL.GREEN),
  })
  .strict()

const NoEchoWriteReceiptBaseSchema = z.discriminatedUnion("slot", [
  BlueWriteReceiptSchema,
  GreenWriteReceiptSchema,
])
export const NoEchoWriteReceiptSchema = withDeepReadonlyOutput(
  NoEchoWriteReceiptBaseSchema,
)

const StartedManagerReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal(FINGERPRINT_RECEIPT_KIND.STARTED_MANAGER),
    applicationId: UuidSchema,
    managerInstanceId: UuidSchema,
    managerImageDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    observedAt: z.string().datetime({ offset: true }),
    createTokenKeyId: Sha256Schema,
    configSha256: Sha256Schema,
    fingerprintHmacSha256: Sha256Schema,
    managerStatusSha256: Sha256Schema,
    configEnvSha256: Sha256Schema,
    processEnvironmentSha256: Sha256Schema,
    fdInventorySha256: Sha256Schema,
  })
  .strict()

const ConfigBoundProofSchema = z
  .object({
    proofLevel: z.literal(FINGERPRINT_PROOF_LEVEL.CONFIG_BOUND),
    projectRuntimeState: z.nativeEnum(MANAGED_PROJECT_RUNTIME_STATE),
    configReceipt: NoEchoWriteReceiptBaseSchema,
  })
  .strict()

const RuntimeVerifiedProofSchema = z
  .object({
    proofLevel: z.literal(FINGERPRINT_PROOF_LEVEL.RUNTIME_VERIFIED),
    projectRuntimeState: z.literal(MANAGED_PROJECT_RUNTIME_STATE.ACTIVE),
    configReceipt: NoEchoWriteReceiptBaseSchema,
    startedManagerReceipt: StartedManagerReceiptSchema,
  })
  .strict()

function assertNever(value: never): never {
  return value
}

const FingerprintProofBaseSchema = z
  .discriminatedUnion("proofLevel", [ConfigBoundProofSchema, RuntimeVerifiedProofSchema])
  .superRefine((proof, context) => {
    switch (proof.proofLevel) {
      case FINGERPRINT_PROOF_LEVEL.CONFIG_BOUND:
        return
      case FINGERPRINT_PROOF_LEVEL.RUNTIME_VERIFIED: {
        const config = proof.configReceipt
        const runtime = proof.startedManagerReceipt
        const matches =
          config.applicationId === runtime.applicationId &&
          config.createTokenKeyId === runtime.createTokenKeyId &&
          config.configSha256 === runtime.configSha256 &&
          config.fingerprintHmacSha256 === runtime.fingerprintHmacSha256
        if (!matches) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "started manager receipt does not match the config receipt",
          })
        }
        return
      }
      default:
        return assertNever(proof)
    }
  })

export const FingerprintProofSchema = withDeepReadonlyOutput(FingerprintProofBaseSchema)

type FingerprintReceiptErrorCode =
  (typeof FINGERPRINT_RECEIPT_ERROR_CODE)[keyof typeof FINGERPRINT_RECEIPT_ERROR_CODE]

export class FingerprintReceiptError extends Error {
  public override readonly name = "FingerprintReceiptError"

  public constructor(
    public readonly code: FingerprintReceiptErrorCode,
    detail: string,
  ) {
    super(detail)
  }
}

export type FingerprintReceiptPairInput = Readonly<{
  readonly blueReceiptInput: unknown
  readonly greenReceiptInput: unknown
}>

export type FingerprintReceiptPair = Readonly<{
  readonly proofLevel: typeof FINGERPRINT_PROOF_LEVEL.CONFIG_BOUND
  readonly createTokenKeyId: string
  readonly fingerprintHmacSha256: string
  readonly applicationIds: readonly [string, string]
  readonly poolIds: readonly [string, string]
}>

export function verifyFingerprintReceiptPair(
  input: FingerprintReceiptPairInput,
): FingerprintReceiptPair {
  const blue = BlueWriteReceiptSchema.parse(input.blueReceiptInput)
  const green = GreenWriteReceiptSchema.parse(input.greenReceiptInput)
  if (blue.createTokenKeyId !== green.createTokenKeyId) {
    throw new FingerprintReceiptError(
      FINGERPRINT_RECEIPT_ERROR_CODE.KEY_ID_MISMATCH,
      "config receipt key IDs do not match",
    )
  }
  if (blue.fingerprintHmacSha256 !== green.fingerprintHmacSha256) {
    throw new FingerprintReceiptError(
      FINGERPRINT_RECEIPT_ERROR_CODE.FINGERPRINT_MISMATCH,
      "config receipt fingerprints do not match",
    )
  }
  return {
    proofLevel: FINGERPRINT_PROOF_LEVEL.CONFIG_BOUND,
    createTokenKeyId: blue.createTokenKeyId,
    fingerprintHmacSha256: blue.fingerprintHmacSha256,
    applicationIds: [blue.applicationId, green.applicationId],
    poolIds: [blue.poolId, green.poolId],
  }
}
