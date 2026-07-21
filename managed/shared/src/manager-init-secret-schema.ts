import { z } from "zod"

import { MANAGED_DEPLOYMENT_CONFIG } from "./deployment-topology.js"
import {
  MANAGER_INIT_DESCRIPTOR_KIND,
  MANAGER_INIT_DESTINATION_MOUNT,
  MANAGER_INIT_MOUNT_EVIDENCE_SOURCE,
  MANAGER_INIT_OPEN_FLAG,
  REQUIRED_MANAGER_INIT_MOUNT_FLAGS,
} from "./manager-init-vocabulary.js"

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

const FinalSecretSchema = z
  .object({
    path: z.literal(MANAGED_DEPLOYMENT_CONFIG.managerSecretTargetPath),
    uid: z.literal(MANAGER_INIT_DESTINATION_MOUNT.UID),
    gid: z.literal(MANAGER_INIT_DESTINATION_MOUNT.GID),
    mode: z.literal(0o400),
    regularFile: z.literal(true),
    readableByManager: z.literal(true),
    readableByWorkers: z.literal(false),
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

export const managerInitSecretContractFields = {
  secretSource: SecretSourceSchema,
  openRecords: z.tuple([SourceOpenRecordSchema, DestinationOpenRecordSchema]),
  copy: CopyContractSchema,
  destinationMount: DestinationMountContractSchema,
  finalSecret: FinalSecretSchema,
  leakScan: LeakScanSchema,
} as const
