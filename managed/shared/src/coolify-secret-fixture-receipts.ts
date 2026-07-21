import { NoEchoWriteReceiptSchema } from "./fingerprint-receipt.js"
import {
  FINGERPRINT_RECEIPT_KIND,
  MANAGED_SECRET_ENVIRONMENT_KEY,
  RECEIPT_SIGNATURE_ALGORITHM,
} from "./fingerprint-receipt-vocabulary.js"
import type { SecretFingerprint } from "./secret-fingerprint.js"
import { COOLIFY_PRODUCTION_OWNER, FINGERPRINT_PROOF_LEVEL } from "./deployment-vocabulary.js"
import { EXPECTED_OVERLAY_PLAN_SHA256 } from "./managed-overlay-catalog.js"
import { sha256 } from "./upstream-corpus-primitives.js"
import { RUNTIME_SCOPE_POOL } from "./runtime-scope-vocabulary.js"

type ManagedSlot =
  | typeof COOLIFY_PRODUCTION_OWNER.MANAGED_BLUE
  | typeof COOLIFY_PRODUCTION_OWNER.MANAGED_GREEN

function assertNever(value: never): never {
  return value
}

export function buildConfigReceipt(slot: ManagedSlot, fingerprint: SecretFingerprint) {
  const common = {
    schemaVersion: 1,
    kind: FINGERPRINT_RECEIPT_KIND.CONFIG_WRITE,
    proofLevel: FINGERPRINT_PROOF_LEVEL.CONFIG_BOUND,
    createTokenKeyId: fingerprint.createTokenKeyId,
    fingerprintHmacSha256: fingerprint.fingerprintHmacSha256,
    overlayPlanSha256: EXPECTED_OVERLAY_PLAN_SHA256,
    environment: {
      key: MANAGED_SECRET_ENVIRONMENT_KEY,
      isPreview: false,
      isLiteral: true,
      isMultiline: false,
      isShownOnce: true,
      isRuntime: true,
      isBuildtime: false,
    },
    signature: {
      algorithm: RECEIPT_SIGNATURE_ALGORITHM.HMAC_SHA256,
      keyId: sha256("synthetic-receipt-signing-key-id"),
      hmacSha256: sha256(`synthetic-receipt-signature:${slot}`),
    },
  } as const
  switch (slot) {
    case COOLIFY_PRODUCTION_OWNER.MANAGED_BLUE:
      return NoEchoWriteReceiptSchema.parse({
        ...common,
        applicationId: "10000000-0000-4000-8000-000000000001",
        slot,
        poolId: RUNTIME_SCOPE_POOL.BLUE,
        configSha256: sha256("synthetic-blue-config"),
        environment: { ...common.environment, uuid: "20000000-0000-4000-8000-000000000001" },
      })
    case COOLIFY_PRODUCTION_OWNER.MANAGED_GREEN:
      return NoEchoWriteReceiptSchema.parse({
        ...common,
        applicationId: "10000000-0000-4000-8000-000000000002",
        slot,
        poolId: RUNTIME_SCOPE_POOL.GREEN,
        configSha256: sha256("synthetic-green-config"),
        environment: { ...common.environment, uuid: "20000000-0000-4000-8000-000000000002" },
      })
    default:
      return assertNever(slot)
  }
}

export function buildStartedManagerReceipt(configReceipt: ReturnType<typeof buildConfigReceipt>) {
  return {
    schemaVersion: 1,
    kind: FINGERPRINT_RECEIPT_KIND.STARTED_MANAGER,
    applicationId: configReceipt.applicationId,
    managerInstanceId: "30000000-0000-4000-8000-000000000001",
    managerImageDigest: `sha256:${sha256("synthetic-manager-image")}`,
    observedAt: "2026-07-20T14:00:00.000Z",
    createTokenKeyId: configReceipt.createTokenKeyId,
    configSha256: configReceipt.configSha256,
    fingerprintHmacSha256: configReceipt.fingerprintHmacSha256,
    managerStatusSha256: sha256("synthetic-manager-status"),
    configEnvSha256: sha256("synthetic-config-env"),
    processEnvironmentSha256: sha256("synthetic-process-env"),
    fdInventorySha256: sha256("synthetic-fd-inventory"),
  }
}
