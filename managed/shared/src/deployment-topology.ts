import { z } from "zod"

import {
  COOLIFY_COMPOSE_DEPLOYMENT_MODE,
  COOLIFY_CUTOVER_MODE,
  COOLIFY_PRODUCTION_OWNER,
  COOLIFY_SECRET_ISOLATION_MODE,
  DISCOVERY_MODE,
  MANAGED_PROJECT_RUNTIME_STATE,
} from "./deployment-vocabulary.js"
import { DeploymentCapacityStatusSchema } from "./deployment-vocabulary-schemas.js"

const GIB = 1_073_741_824

export const MANAGED_DEPLOYMENT_CONFIG = {
  maxConcurrentManagedProjects: 1,
  activeManagerCount: 1,
  activeWorkerCount: 2,
  activeContainerCount: 3,
  activeListenerCount: 4,
  staticWorkerEndpoints: [
    "worker-00=http://worker-00:3000",
    "worker-01=http://worker-01:3000",
  ],
  managerSecretSourcePath: "/run/steel-secret-source/managed-create-token-key",
  managerSecretTargetPath: "/run/steel/managed-create-token-key",
  managerSecretGrantCount: 1,
  workerSecretGrantCount: 0,
  capacityUtilizationRatio: 0.8,
  cpuThrottleRatio: 0.05,
  postStartDiskFreeRatio: 0.2,
  postStartInodeFreeRatio: 0.1,
  memoryReserveMiB: 2_048,
  cpuReserveCores: 0.5,
  minimumDiskReserveBytes: 5 * GIB,
  minimumInodeReserve: 100_000,
  capacitySampleCount: 300,
  capacityWindowSeconds: 300,
  capacitySampleIntervalSeconds: 1,
  handoverOverlapMs: 5_000,
  workerPressureLoopSeconds: 10,
} as const

const ManagedProjectSlotSchema = z.union([
  z.literal(COOLIFY_PRODUCTION_OWNER.MANAGED_BLUE),
  z.literal(COOLIFY_PRODUCTION_OWNER.MANAGED_GREEN),
])
const RuntimeCountSchema = z.number().int().nonnegative()

const ActiveManagedProjectSchema = z
  .object({
    slot: ManagedProjectSlotSchema,
    runtimeState: z.literal(MANAGED_PROJECT_RUNTIME_STATE.ACTIVE),
    managerCount: z.literal(MANAGED_DEPLOYMENT_CONFIG.activeManagerCount),
    workerCount: z.literal(MANAGED_DEPLOYMENT_CONFIG.activeWorkerCount),
    containerCount: z.literal(MANAGED_DEPLOYMENT_CONFIG.activeContainerCount),
    listenerCount: RuntimeCountSchema,
    connectionCount: RuntimeCountSchema,
    automaticRestartEnabled: z.boolean(),
  })
  .strict()

const ColdStandbyManagedProjectSchema = z
  .object({
    slot: ManagedProjectSlotSchema,
    runtimeState: z.literal(MANAGED_PROJECT_RUNTIME_STATE.COLD_STANDBY),
    managerCount: z.literal(0),
    workerCount: z.literal(0),
    containerCount: z.literal(0),
    listenerCount: z.literal(0),
    connectionCount: z.literal(0),
    automaticRestartEnabled: z.literal(false),
  })
  .strict()

const StoppedFailedManagedProjectSchema = z
  .object({
    slot: ManagedProjectSlotSchema,
    runtimeState: z.literal(MANAGED_PROJECT_RUNTIME_STATE.STOPPED_FAILED),
    managerCount: z.literal(0),
    workerCount: z.literal(0),
    containerCount: z.literal(0),
    listenerCount: z.literal(0),
    connectionCount: z.literal(0),
    automaticRestartEnabled: z.literal(false),
  })
  .strict()

export const ManagedProjectRuntimeSchema = z.discriminatedUnion("runtimeState", [
  ActiveManagedProjectSchema,
  ColdStandbyManagedProjectSchema,
  StoppedFailedManagedProjectSchema,
])

export const ManagerSecretIsolationSchema = z
  .object({
    sourcePath: z.literal(MANAGED_DEPLOYMENT_CONFIG.managerSecretSourcePath),
    targetPath: z.literal(MANAGED_DEPLOYMENT_CONFIG.managerSecretTargetPath),
    managerGrantCount: z.literal(MANAGED_DEPLOYMENT_CONFIG.managerSecretGrantCount),
    workerGrantCount: z.literal(MANAGED_DEPLOYMENT_CONFIG.workerSecretGrantCount),
    containerEnvironmentKeys: z.tuple([]),
    serviceEnvironmentFiles: z.tuple([]),
  })
  .strict()

export const ManagedDeploymentSourceConfigSchema = z
  .object({
    maxConcurrentManagedProjects: z.literal(MANAGED_DEPLOYMENT_CONFIG.maxConcurrentManagedProjects),
    activeWorkerCount: z.literal(MANAGED_DEPLOYMENT_CONFIG.activeWorkerCount),
    maxVerifiedWorkersTotal: z.literal(MANAGED_DEPLOYMENT_CONFIG.activeWorkerCount),
    discoveryMode: z.literal(DISCOVERY_MODE.STATIC_CONFIG),
    staticWorkerEndpoints: z.tuple([
      z.literal(MANAGED_DEPLOYMENT_CONFIG.staticWorkerEndpoints[0]),
      z.literal(MANAGED_DEPLOYMENT_CONFIG.staticWorkerEndpoints[1]),
    ]),
    cutoverMode: z.literal(COOLIFY_CUTOVER_MODE.SERIAL_MAINTENANCE),
    composeDeploymentMode: z.literal(COOLIFY_COMPOSE_DEPLOYMENT_MODE.RAW_EXPLICIT_PROXY),
    secretIsolationMode: z.literal(COOLIFY_SECRET_ISOLATION_MODE.RAW_COMPOSE_MANAGER_SECRET),
    managerSecret: ManagerSecretIsolationSchema,
    capacityStatus: DeploymentCapacityStatusSchema,
  })
  .strict()

export const ManagedDeploymentTopologySchema = z
  .object({
    config: ManagedDeploymentSourceConfigSchema,
    projects: z.tuple([ManagedProjectRuntimeSchema, ManagedProjectRuntimeSchema]),
  })
  .strict()
  .superRefine((topology, context) => {
    const activeProjectCount = topology.projects.filter(
      (project) => project.runtimeState === MANAGED_PROJECT_RUNTIME_STATE.ACTIVE,
    ).length
    const coldStandbyCount = topology.projects.filter(
      (project) => project.runtimeState === MANAGED_PROJECT_RUNTIME_STATE.COLD_STANDBY,
    ).length
    const distinctSlots = new Set(topology.projects.map((project) => project.slot)).size
    if (activeProjectCount !== MANAGED_DEPLOYMENT_CONFIG.maxConcurrentManagedProjects) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "exactly one managed project must be active" })
    }
    if (coldStandbyCount !== MANAGED_DEPLOYMENT_CONFIG.maxConcurrentManagedProjects) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "exactly one managed project must be cold standby" })
    }
    if (distinctSlots !== topology.projects.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "managed project slots must be distinct" })
    }
  })

export type ManagedProjectRuntime = Readonly<z.infer<typeof ManagedProjectRuntimeSchema>>
export type ManagedDeploymentSourceConfig = Readonly<z.infer<typeof ManagedDeploymentSourceConfigSchema>>
export type ManagedDeploymentTopology = Readonly<z.infer<typeof ManagedDeploymentTopologySchema>>
