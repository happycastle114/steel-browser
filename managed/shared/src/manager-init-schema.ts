import { z } from "zod"

import { withDeepFrozenOutput } from "./deep-readonly.js"
import { FINGERPRINT_PROOF_LEVEL } from "./deployment-vocabulary.js"
import { managerInitRuntimeContractFields } from "./manager-init-runtime-schema.js"
import { managerInitSecretContractFields } from "./manager-init-secret-schema.js"
import {
  MANAGER_INIT_PLATFORM,
  MANAGER_INIT_VERIFICATION_SURFACE,
} from "./manager-init-vocabulary.js"

const SyntheticContractFixtureSchema = z
  .object({
    schemaVersion: z.literal(1),
    compose: managerInitRuntimeContractFields.compose,
    initialProcess: managerInitRuntimeContractFields.initialProcess,
    secretSource: managerInitSecretContractFields.secretSource,
    openRecords: managerInitSecretContractFields.openRecords,
    copy: managerInitSecretContractFields.copy,
    destinationMount: managerInitSecretContractFields.destinationMount,
    initTrace: managerInitRuntimeContractFields.initTrace,
    fdScans: managerInitRuntimeContractFields.fdScans,
    finalSecret: managerInitSecretContractFields.finalSecret,
    finalStatus: managerInitRuntimeContractFields.finalStatus,
    leakScan: managerInitSecretContractFields.leakScan,
    executionReceipt: managerInitRuntimeContractFields.executionReceipt,
    verificationSurface: z.literal(MANAGER_INIT_VERIFICATION_SURFACE.SYNTHETIC_CONTRACT),
    proofLevel: z.literal(FINGERPRINT_PROOF_LEVEL.CONFIG_BOUND),
    platform: z.literal(MANAGER_INIT_PLATFORM.CONTRACT_FIXTURE),
  })
  .strict()

const ManagerInitVerificationSurfaceBaseSchema = z
  .object({
    verificationSurface: z.union([
      z.literal(MANAGER_INIT_VERIFICATION_SURFACE.SYNTHETIC_CONTRACT),
      z.literal(MANAGER_INIT_VERIFICATION_SURFACE.LIVE_LINUX),
    ]),
  })
  .passthrough()

export const ManagerInitContractFixtureSchema = withDeepFrozenOutput(
  SyntheticContractFixtureSchema,
)
export const ManagerInitVerificationSurfaceSchema = withDeepFrozenOutput(
  ManagerInitVerificationSurfaceBaseSchema,
)

export type ManagerInitContractFixture = z.infer<typeof ManagerInitContractFixtureSchema>
