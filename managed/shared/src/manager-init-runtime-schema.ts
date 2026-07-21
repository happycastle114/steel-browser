import { z } from "zod"

import {
  COOLIFY_COMPOSE_DEPLOYMENT_MODE,
  COOLIFY_SECRET_ISOLATION_MODE,
  FINGERPRINT_PROOF_LEVEL,
} from "./deployment-vocabulary.js"
import {
  MANAGER_INIT_CLEANUP_STATUS,
  MANAGER_INIT_DESTINATION_MOUNT,
  MANAGER_INIT_EXECUTION_RECEIPT_KIND,
  MANAGER_INIT_FD_TARGET_CLASS,
  MANAGER_INIT_SEQUENCE,
  MANAGER_LINUX_CAPABILITY,
} from "./manager-init-vocabulary.js"

const ZERO_CAPABILITIES = "0000000000000000"

const ServiceEnvironmentKeysSchema = z
  .object({
    manager: z.tuple([]),
    worker00: z.tuple([]),
    worker01: z.tuple([]),
  })
  .strict()

const ComposeContractSchema = z
  .object({
    deploymentMode: z.literal(COOLIFY_COMPOSE_DEPLOYMENT_MODE.RAW_EXPLICIT_PROXY),
    secretIsolationMode: z.literal(COOLIFY_SECRET_ISOLATION_MODE.RAW_COMPOSE_MANAGER_SECRET),
    generatedServiceEnvFile: z.literal(false),
    serviceEnvironmentKeys: ServiceEnvironmentKeysSchema,
  })
  .strict()

const InitialProcessSchema = z
  .object({
    pid: z.literal(1),
    uid: z.literal(0),
    gid: z.literal(0),
    supplementaryGroups: z.tuple([]),
    capabilities: z.tuple([
      z.literal(MANAGER_LINUX_CAPABILITY.CHOWN),
      z.literal(MANAGER_LINUX_CAPABILITY.SETUID),
      z.literal(MANAGER_LINUX_CAPABILITY.SETGID),
      z.literal(MANAGER_LINUX_CAPABILITY.SETPCAP),
    ]),
  })
  .strict()

const InitTraceSchema = z.tuple([
  z.literal(MANAGER_INIT_SEQUENCE[0]),
  z.literal(MANAGER_INIT_SEQUENCE[1]),
  z.literal(MANAGER_INIT_SEQUENCE[2]),
  z.literal(MANAGER_INIT_SEQUENCE[3]),
  z.literal(MANAGER_INIT_SEQUENCE[4]),
  z.literal(MANAGER_INIT_SEQUENCE[5]),
  z.literal(MANAGER_INIT_SEQUENCE[6]),
  z.literal(MANAGER_INIT_SEQUENCE[7]),
  z.literal(MANAGER_INIT_SEQUENCE[8]),
  z.literal(MANAGER_INIT_SEQUENCE[9]),
  z.literal(MANAGER_INIT_SEQUENCE[10]),
  z.literal(MANAGER_INIT_SEQUENCE[11]),
  z.literal(MANAGER_INIT_SEQUENCE[12]),
  z.literal(MANAGER_INIT_SEQUENCE[13]),
  z.literal(MANAGER_INIT_SEQUENCE[14]),
  z.literal(MANAGER_INIT_SEQUENCE[15]),
  z.literal(MANAGER_INIT_SEQUENCE[16]),
])

const FdScanSchema = z
  .object({
    descriptors: z.tuple([
      z.object({ fd: z.literal(0), targetClass: z.literal(MANAGER_INIT_FD_TARGET_CLASS.STDIN) }).strict(),
      z.object({ fd: z.literal(1), targetClass: z.literal(MANAGER_INIT_FD_TARGET_CLASS.STDOUT) }).strict(),
      z.object({ fd: z.literal(2), targetClass: z.literal(MANAGER_INIT_FD_TARGET_CLASS.STDERR) }).strict(),
    ]),
    secretPathMatches: z.literal(0),
    unclassifiedDescriptors: z.literal(0),
  })
  .strict()

const FinalStatusSchema = z
  .object({
    uid: z.tuple([
      z.literal(MANAGER_INIT_DESTINATION_MOUNT.UID),
      z.literal(MANAGER_INIT_DESTINATION_MOUNT.UID),
      z.literal(MANAGER_INIT_DESTINATION_MOUNT.UID),
      z.literal(MANAGER_INIT_DESTINATION_MOUNT.UID),
    ]),
    gid: z.tuple([
      z.literal(MANAGER_INIT_DESTINATION_MOUNT.GID),
      z.literal(MANAGER_INIT_DESTINATION_MOUNT.GID),
      z.literal(MANAGER_INIT_DESTINATION_MOUNT.GID),
      z.literal(MANAGER_INIT_DESTINATION_MOUNT.GID),
    ]),
    supplementaryGroups: z.tuple([]),
    capabilities: z
      .object({
        CapInh: z.literal(ZERO_CAPABILITIES),
        CapPrm: z.literal(ZERO_CAPABILITIES),
        CapEff: z.literal(ZERO_CAPABILITIES),
        CapBnd: z.literal(ZERO_CAPABILITIES),
        CapAmb: z.literal(ZERO_CAPABILITIES),
      })
      .strict(),
    noNewPrivs: z.literal(1),
  })
  .strict()

const SyntheticExecutionReceiptSchema = z
  .object({
    kind: z.literal(MANAGER_INIT_EXECUTION_RECEIPT_KIND.SYNTHETIC_CONTRACT),
    proofLevel: z.literal(FINGERPRINT_PROOF_LEVEL.CONFIG_BOUND),
    liveResourcesCreated: z.literal(0),
    cleanupStatus: z.literal(MANAGER_INIT_CLEANUP_STATUS.NOT_APPLICABLE),
  })
  .strict()

export const managerInitRuntimeContractFields = {
  compose: ComposeContractSchema,
  initialProcess: InitialProcessSchema,
  initTrace: InitTraceSchema,
  fdScans: z.object({ beforePrivilegeDrop: FdScanSchema, afterPrivilegeDrop: FdScanSchema }).strict(),
  finalStatus: FinalStatusSchema,
  executionReceipt: SyntheticExecutionReceiptSchema,
} as const
