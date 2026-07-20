import { CAPACITY_GATE_RESULT, type CapacityGateResult } from "./deployment-capacity-result.js"
import {
  CpuCapacityInputSchema,
  DiskCapacityInputSchema,
  InodeCapacityInputSchema,
  MemoryCapacityInputSchema,
  type CpuCapacityInput,
  type MemoryCapacityInput,
} from "./deployment-capacity-schemas.js"
import { MANAGED_DEPLOYMENT_CONFIG } from "./deployment-topology.js"
import {
  CAPACITY_PHASE,
  DISK_CAPACITY_STAGE,
  INODE_CAPACITY_STAGE,
} from "./deployment-vocabulary.js"

const MIB = 1_048_576

export function requiredManagedMemoryMiB(input: Readonly<{
  readonly managerLimitBytes: number
  readonly workerLimitBytes: number
}>): number {
  return (
    Math.ceil(input.managerLimitBytes / MIB) +
    MANAGED_DEPLOYMENT_CONFIG.activeWorkerCount * Math.ceil(input.workerLimitBytes / MIB)
  )
}

function memoryBudgetMiB(input: MemoryCapacityInput): number {
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
      return assertNever(input)
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

function cpuBudgetCores(input: CpuCapacityInput): number {
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
      return assertNever(input)
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
      return assertNever(parsed.data)
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
      return assertNever(parsed.data)
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
