import { z } from "zod"

import { withDeepReadonlyOutput } from "./deep-readonly.js"
import { MANAGED_DEPLOYMENT_CONFIG } from "./deployment-topology.js"
import {
  COOLIFY_COMPOSE_DEPLOYMENT_MODE,
  COOLIFY_SECRET_ISOLATION_MODE,
  FINGERPRINT_PROOF_LEVEL,
} from "./deployment-vocabulary.js"
import {
  MANAGER_INIT_DESCRIPTOR_KIND,
  MANAGER_INIT_DESTINATION_MOUNT,
  MANAGER_INIT_CLEANUP_STATUS,
  MANAGER_INIT_EXECUTION_RECEIPT_KIND,
  MANAGER_INIT_FD_TARGET_CLASS,
  MANAGER_INIT_MOUNT_EVIDENCE_SOURCE,
  MANAGER_INIT_OPEN_FLAG,
  MANAGER_INIT_PLATFORM,
  MANAGER_INIT_SEQUENCE,
  MANAGER_INIT_VERIFICATION_SURFACE,
  MANAGER_LINUX_CAPABILITY,
  REQUIRED_MANAGER_INIT_MOUNT_FLAGS,
} from "./manager-init-vocabulary.js"

const ZERO_CAPABILITIES = "0000000000000000"
const MANAGER_UID = 10_001

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

const SecretSourceSchema = z
  .object({
    directoryPath: z.literal("/run/steel-secret-source"),
    directoryUid: z.literal(0),
    directoryGid: z.literal(0),
    directoryMode: z.literal(0o700),
    path: z.literal(MANAGED_DEPLOYMENT_CONFIG.managerSecretSourcePath),
    regularFile: z.literal(true),
    validatedByteLength: z.literal(64),
    lowercaseHex: z.literal(true),
    mountedServices: z.tuple([z.literal("manager")]),
    traversableByFinalManager: z.literal(false),
    workerReadPaths: z.tuple([]),
  })
  .strict()

const SourceOpenRecordSchema = z
  .object({
    kind: z.literal(MANAGER_INIT_DESCRIPTOR_KIND.SOURCE),
    fd: z.literal(3),
    path: z.literal(MANAGED_DEPLOYMENT_CONFIG.managerSecretSourcePath),
    flags: z.tuple([
      z.literal(MANAGER_INIT_OPEN_FLAG.O_RDONLY),
      z.literal(MANAGER_INIT_OPEN_FLAG.O_CLOEXEC),
      z.literal(MANAGER_INIT_OPEN_FLAG.O_NOFOLLOW),
    ]),
    closedBeforePrivilegeDrop: z.literal(true),
  })
  .strict()

const DestinationOpenRecordSchema = z
  .object({
    kind: z.literal(MANAGER_INIT_DESCRIPTOR_KIND.DESTINATION),
    fd: z.literal(4),
    path: z.literal(MANAGED_DEPLOYMENT_CONFIG.managerSecretTargetPath),
    flags: z.tuple([
      z.literal(MANAGER_INIT_OPEN_FLAG.O_WRONLY),
      z.literal(MANAGER_INIT_OPEN_FLAG.O_CREAT),
      z.literal(MANAGER_INIT_OPEN_FLAG.O_EXCL),
      z.literal(MANAGER_INIT_OPEN_FLAG.O_CLOEXEC),
      z.literal(MANAGER_INIT_OPEN_FLAG.O_NOFOLLOW),
    ]),
    closedBeforePrivilegeDrop: z.literal(true),
  })
  .strict()

const CopyContractSchema = z
  .object({
    copiedByteLength: z.literal(64),
    sourceValidated: z.literal(true),
    destinationValidated: z.literal(true),
    fsynced: z.literal(true),
    plaintextBuffersZeroized: z.literal(true),
  })
  .strict()

const DestinationMountContractSchema = z
  .object({
    evidenceSource: z.literal(
      MANAGER_INIT_MOUNT_EVIDENCE_SOURCE.SYNTHETIC_EXPECTED_CONTRACT,
    ),
    mountInfoObserved: z.literal(false),
    mountPoint: z.literal(MANAGER_INIT_DESTINATION_MOUNT.PATH),
    fileSystemType: z.literal(MANAGER_INIT_DESTINATION_MOUNT.FILE_SYSTEM_TYPE),
    source: z.literal(MANAGER_INIT_DESTINATION_MOUNT.SOURCE),
    uid: z.literal(MANAGER_INIT_DESTINATION_MOUNT.UID),
    gid: z.literal(MANAGER_INIT_DESTINATION_MOUNT.GID),
    mode: z.literal(MANAGER_INIT_DESTINATION_MOUNT.MODE),
    sizeBytes: z.literal(MANAGER_INIT_DESTINATION_MOUNT.SIZE_BYTES),
    requiredFlags: z.tuple([
      z.literal(REQUIRED_MANAGER_INIT_MOUNT_FLAGS[0]),
      z.literal(REQUIRED_MANAGER_INIT_MOUNT_FLAGS[1]),
      z.literal(REQUIRED_MANAGER_INIT_MOUNT_FLAGS[2]),
      z.literal(REQUIRED_MANAGER_INIT_MOUNT_FLAGS[3]),
    ]),
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

const FinalSecretSchema = z
  .object({
    path: z.literal(MANAGED_DEPLOYMENT_CONFIG.managerSecretTargetPath),
    uid: z.literal(MANAGER_UID),
    gid: z.literal(MANAGER_UID),
    mode: z.literal(0o400),
    regularFile: z.literal(true),
    readableByManager: z.literal(true),
    readableByWorkers: z.literal(false),
  })
  .strict()

const FinalStatusSchema = z
  .object({
    uid: z.tuple([z.literal(MANAGER_UID), z.literal(MANAGER_UID), z.literal(MANAGER_UID), z.literal(MANAGER_UID)]),
    gid: z.tuple([z.literal(MANAGER_UID), z.literal(MANAGER_UID), z.literal(MANAGER_UID), z.literal(MANAGER_UID)]),
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

const LeakScanSchema = z
  .object({
    containerConfigEnvMatches: z.literal(0),
    processEnvironmentMatches: z.literal(0),
    inheritedDescriptorMatches: z.literal(0),
    renderedConfigMatches: z.literal(0),
    workerMountMatches: z.literal(0),
    imageHistoryMatches: z.literal(0),
    buildArgumentMatches: z.literal(0),
    logMatches: z.literal(0),
  })
  .strict()

const contractFields = {
  schemaVersion: z.literal(1),
  compose: ComposeContractSchema,
  initialProcess: InitialProcessSchema,
  secretSource: SecretSourceSchema,
  openRecords: z.tuple([SourceOpenRecordSchema, DestinationOpenRecordSchema]),
  copy: CopyContractSchema,
  destinationMount: DestinationMountContractSchema,
  initTrace: InitTraceSchema,
  fdScans: z.object({ beforePrivilegeDrop: FdScanSchema, afterPrivilegeDrop: FdScanSchema }).strict(),
  finalSecret: FinalSecretSchema,
  finalStatus: FinalStatusSchema,
  leakScan: LeakScanSchema,
  executionReceipt: SyntheticExecutionReceiptSchema,
} as const

const SyntheticContractFixtureSchema = z
  .object({
    ...contractFields,
    verificationSurface: z.literal(MANAGER_INIT_VERIFICATION_SURFACE.SYNTHETIC_CONTRACT),
    proofLevel: z.literal(FINGERPRINT_PROOF_LEVEL.CONFIG_BOUND),
    platform: z.literal(MANAGER_INIT_PLATFORM.CONTRACT_FIXTURE),
  })
  .strict()

const ManagerInitContractFixtureBaseSchema = SyntheticContractFixtureSchema

const ManagerInitVerificationSurfaceBaseSchema = z
  .object({
    verificationSurface: z.union([
      z.literal(MANAGER_INIT_VERIFICATION_SURFACE.SYNTHETIC_CONTRACT),
      z.literal(MANAGER_INIT_VERIFICATION_SURFACE.LIVE_LINUX),
    ]),
  })
  .passthrough()

export const ManagerInitContractFixtureSchema = withDeepReadonlyOutput(
  ManagerInitContractFixtureBaseSchema,
)
export const ManagerInitVerificationSurfaceSchema = withDeepReadonlyOutput(
  ManagerInitVerificationSurfaceBaseSchema,
)

export type ManagerInitContractFixture = z.infer<typeof ManagerInitContractFixtureSchema>
