import { z } from "zod"

import { CAPACITY_GATE_RESULT, type CapacityGateResult } from "./deployment-capacity-result.js"
import { MANAGED_DEPLOYMENT_CONFIG } from "./deployment-topology.js"

const MIB = 1_048_576

export const CAPACITY_PHASE = {
  DISPOSABLE_CANARY: "DISPOSABLE_CANARY",
  PRODUCTION_SERIAL: "PRODUCTION_SERIAL",
} as const
export const DISK_CAPACITY_STAGE = {
  BEFORE_PULLS: "BEFORE_PULLS",
  AFTER_START: "AFTER_START",
} as const
export const INODE_CAPACITY_STAGE = {
  BEFORE_PULLS: "BEFORE_PULLS",
  AFTER_START: "AFTER_START",
} as const

const NonNegativeMeasurementSchema = z.number().finite().nonnegative()
const PositiveByteCountSchema = z.number().int().safe().positive()
const NonNegativeByteCountSchema = z.number().int().safe().nonnegative()
const NonNegativeCountSchema = z.number().int().safe().nonnegative()

const MemoryCapacityInputSchema = z
  .object({
    phase: z.nativeEnum(CAPACITY_PHASE),
    hostTotalMemoryMiB: NonNegativeMeasurementSchema,
    hostNonSteelP95MiB: NonNegativeMeasurementSchema,
    legacySteelP95MiB: NonNegativeMeasurementSchema,
    managerLimitBytes: PositiveByteCountSchema,
    workerLimitBytes: PositiveByteCountSchema,
    usableSamples: NonNegativeCountSchema,
    sampleWindowSeconds: NonNegativeMeasurementSchema,
    sampleIntervalSeconds: NonNegativeMeasurementSchema,
  })
  .strict()

const ThrottlingObservationSchema = z
  .object({ nrThrottled: NonNegativeCountSchema, nrPeriods: z.number().int().safe().positive() })
  .strict()
const CpuCapacityInputSchema = z
  .object({
    phase: z.nativeEnum(CAPACITY_PHASE),
    hostLogicalCpuCount: z.number().finite().positive(),
    hostNonSteelCpuP95Cores: NonNegativeMeasurementSchema,
    legacySteelCpuP95Cores: NonNegativeMeasurementSchema,
    managedCpuP95Cores: NonNegativeMeasurementSchema,
    loadOneP95: NonNegativeMeasurementSchema,
    usableSamples: NonNegativeCountSchema,
    sampleWindowSeconds: NonNegativeMeasurementSchema,
    sampleIntervalSeconds: NonNegativeMeasurementSchema,
    throttling: z.tuple([
      ThrottlingObservationSchema,
      ThrottlingObservationSchema,
      ThrottlingObservationSchema,
    ]),
  })
  .strict()

const DiskCapacityInputSchema = z
  .object({
    stage: z.nativeEnum(DISK_CAPACITY_STAGE),
    freeDiskBytes: NonNegativeByteCountSchema,
    filesystemBytes: PositiveByteCountSchema,
    managerImageSizeBytes: NonNegativeByteCountSchema,
    workerImageSizeBytes: NonNegativeByteCountSchema,
    legacyRollbackLayerBytes: NonNegativeByteCountSchema,
    signedReceiptBundleBytes: NonNegativeByteCountSchema,
  })
  .strict()

const InodeCapacityInputSchema = z
  .object({
    stage: z.nativeEnum(INODE_CAPACITY_STAGE),
    freeInodes: NonNegativeCountSchema,
    totalInodes: z.number().int().safe().positive(),
    managerImageInodes: NonNegativeCountSchema,
    workerImageInodes: NonNegativeCountSchema,
    legacyRollbackInodes: NonNegativeCountSchema,
  })
  .strict()

export function requiredManagedMemoryMiB(input: Readonly<{
  readonly managerLimitBytes: number
  readonly workerLimitBytes: number
}>): number {
  return (
    Math.ceil(input.managerLimitBytes / MIB) +
    MANAGED_DEPLOYMENT_CONFIG.activeWorkerCount * Math.ceil(input.workerLimitBytes / MIB)
  )
}

function memoryBudgetMiB(input: z.infer<typeof MemoryCapacityInputSchema>): number {
  switch (input.phase) {
    case CAPACITY_PHASE.DISPOSABLE_CANARY:
      return (
        input.hostTotalMemoryMiB -
        input.hostNonSteelP95MiB -
        input.legacySteelP95MiB -
        MANAGED_DEPLOYMENT_CONFIG.memoryReserveMiB
      )
    case CAPACITY_PHASE.PRODUCTION_SERIAL:
      return input.hostTotalMemoryMiB - input.hostNonSteelP95MiB - MANAGED_DEPLOYMENT_CONFIG.memoryReserveMiB
    default:
      return assertNever(input.phase)
  }
}

export function evaluateMemoryCapacity(input: unknown): CapacityGateResult {
  const parsed = MemoryCapacityInputSchema.safeParse(input)
  if (!parsed.success) return CAPACITY_GATE_RESULT.BLOCKED_MEASUREMENT
  if (!hasCompleteBaseline(parsed.data)) return CAPACITY_GATE_RESULT.BLOCKED_MEASUREMENT
  const budgetMiB = memoryBudgetMiB(parsed.data)
  const allowedMiB = Math.floor(MANAGED_DEPLOYMENT_CONFIG.capacityUtilizationRatio * budgetMiB)
  if (budgetMiB <= 0 || requiredManagedMemoryMiB(parsed.data) > allowedMiB) {
    return CAPACITY_GATE_RESULT.BLOCKED_MEMORY
  }
  return CAPACITY_GATE_RESULT.VERIFIED
}

function cpuBudgetCores(input: z.infer<typeof CpuCapacityInputSchema>): number {
  switch (input.phase) {
    case CAPACITY_PHASE.DISPOSABLE_CANARY:
      return (
        input.hostLogicalCpuCount -
        input.hostNonSteelCpuP95Cores -
        input.legacySteelCpuP95Cores -
        MANAGED_DEPLOYMENT_CONFIG.cpuReserveCores
      )
    case CAPACITY_PHASE.PRODUCTION_SERIAL:
      return input.hostLogicalCpuCount - input.hostNonSteelCpuP95Cores - MANAGED_DEPLOYMENT_CONFIG.cpuReserveCores
    default:
      return assertNever(input.phase)
  }
}

export function evaluateCpuCapacity(input: unknown): CapacityGateResult {
  const parsed = CpuCapacityInputSchema.safeParse(input)
  if (!parsed.success) return CAPACITY_GATE_RESULT.BLOCKED_MEASUREMENT
  if (!hasCompleteBaseline(parsed.data)) return CAPACITY_GATE_RESULT.BLOCKED_MEASUREMENT
  const budgetCores = cpuBudgetCores(parsed.data)
  const p95Allowed = MANAGED_DEPLOYMENT_CONFIG.capacityUtilizationRatio * budgetCores
  const loadAllowed = MANAGED_DEPLOYMENT_CONFIG.capacityUtilizationRatio * parsed.data.hostLogicalCpuCount
  const throttlingExceeded = parsed.data.throttling.some(
    (observation) =>
      observation.nrThrottled / observation.nrPeriods > MANAGED_DEPLOYMENT_CONFIG.cpuThrottleRatio,
  )
  if (
    budgetCores <= 0 ||
    parsed.data.managedCpuP95Cores > p95Allowed ||
    parsed.data.loadOneP95 > loadAllowed ||
    throttlingExceeded
  ) {
    return CAPACITY_GATE_RESULT.BLOCKED_CPU
  }
  return CAPACITY_GATE_RESULT.VERIFIED
}

export function evaluateDiskCapacity(input: unknown): CapacityGateResult {
  const parsed = DiskCapacityInputSchema.safeParse(input)
  if (!parsed.success) return CAPACITY_GATE_RESULT.BLOCKED_MEASUREMENT
  let requiredFreeBytes: number
  switch (parsed.data.stage) {
    case DISK_CAPACITY_STAGE.BEFORE_PULLS:
      requiredFreeBytes =
        2 *
          (parsed.data.managerImageSizeBytes +
            MANAGED_DEPLOYMENT_CONFIG.activeWorkerCount * parsed.data.workerImageSizeBytes) +
        parsed.data.legacyRollbackLayerBytes +
        parsed.data.signedReceiptBundleBytes +
        MANAGED_DEPLOYMENT_CONFIG.minimumDiskReserveBytes
      break
    case DISK_CAPACITY_STAGE.AFTER_START:
      requiredFreeBytes = Math.max(
        MANAGED_DEPLOYMENT_CONFIG.minimumDiskReserveBytes,
        Math.ceil(MANAGED_DEPLOYMENT_CONFIG.postStartDiskFreeRatio * parsed.data.filesystemBytes),
      )
      break
    default:
      return assertNever(parsed.data.stage)
  }
  return parsed.data.freeDiskBytes >= requiredFreeBytes
    ? CAPACITY_GATE_RESULT.VERIFIED
    : CAPACITY_GATE_RESULT.BLOCKED_DISK
}

export function evaluateInodeCapacity(input: unknown): CapacityGateResult {
  const parsed = InodeCapacityInputSchema.safeParse(input)
  if (!parsed.success) return CAPACITY_GATE_RESULT.BLOCKED_MEASUREMENT
  let requiredFreeInodes: number
  switch (parsed.data.stage) {
    case INODE_CAPACITY_STAGE.BEFORE_PULLS:
      requiredFreeInodes =
        2 *
          (parsed.data.managerImageInodes +
            MANAGED_DEPLOYMENT_CONFIG.activeWorkerCount * parsed.data.workerImageInodes) +
        parsed.data.legacyRollbackInodes +
        MANAGED_DEPLOYMENT_CONFIG.minimumInodeReserve
      break
    case INODE_CAPACITY_STAGE.AFTER_START:
      requiredFreeInodes = Math.max(
        MANAGED_DEPLOYMENT_CONFIG.minimumInodeReserve,
        Math.ceil(MANAGED_DEPLOYMENT_CONFIG.postStartInodeFreeRatio * parsed.data.totalInodes),
      )
      break
    default:
      return assertNever(parsed.data.stage)
  }
  return parsed.data.freeInodes >= requiredFreeInodes
    ? CAPACITY_GATE_RESULT.VERIFIED
    : CAPACITY_GATE_RESULT.BLOCKED_INODES
}

function assertNever(value: never): never {
  throw new RangeError(`unreachable capacity member: ${String(value)}`)
}

function hasCompleteBaseline(input: Readonly<{
  readonly usableSamples: number
  readonly sampleWindowSeconds: number
  readonly sampleIntervalSeconds: number
}>): boolean {
  return (
    input.usableSamples === MANAGED_DEPLOYMENT_CONFIG.capacitySampleCount &&
    input.sampleWindowSeconds === MANAGED_DEPLOYMENT_CONFIG.capacityWindowSeconds &&
    input.sampleIntervalSeconds === MANAGED_DEPLOYMENT_CONFIG.capacitySampleIntervalSeconds
  )
}
