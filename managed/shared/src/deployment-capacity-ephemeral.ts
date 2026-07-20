import { z } from "zod"

import { CAPACITY_GATE_RESULT, type CapacityGateResult } from "./deployment-capacity-result.js"
import { MANAGED_DEPLOYMENT_CONFIG } from "./deployment-topology.js"

const ByteCountSchema = z.number().int().safe().nonnegative()

export const ShmTmpfsCapacityInputSchema = z
  .object({
    manager: z
      .object({
        limitBytes: z.number().int().safe().positive(),
        baseP95Bytes: ByteCountSchema,
        tmpfsLimitBytes: ByteCountSchema,
        otherReservedBytes: ByteCountSchema,
        actualTmpfsLimitBytes: ByteCountSchema,
        signedTmpfsLimitBytes: ByteCountSchema,
      })
      .strict(),
    worker: z
      .object({
        limitBytes: z.number().int().safe().positive(),
        baseP95Bytes: ByteCountSchema,
        shmLimitBytes: ByteCountSchema,
        runTmpfsBytes: ByteCountSchema,
        tmpTmpfsBytes: ByteCountSchema,
        profileTmpfsBytes: ByteCountSchema,
        actualShmLimitBytes: ByteCountSchema,
        actualRunTmpfsBytes: ByteCountSchema,
        actualTmpTmpfsBytes: ByteCountSchema,
        actualProfileTmpfsBytes: ByteCountSchema,
        signedShmLimitBytes: ByteCountSchema,
        signedRunTmpfsBytes: ByteCountSchema,
        signedTmpTmpfsBytes: ByteCountSchema,
        signedProfileTmpfsBytes: ByteCountSchema,
        baseP95BytesByWorker: z.tuple([
          z.number().int().safe().positive(),
          z.number().int().safe().positive(),
        ]),
      })
      .strict(),
    measurementFresh: z.boolean(),
    mountsBounded: z.boolean(),
    warmIdleUsableSamplesByWorker: z.tuple([
      z.number().int().safe().nonnegative(),
      z.number().int().safe().nonnegative(),
    ]),
    warmIdleSampleIntervalSeconds: z.number().finite().nonnegative(),
    warmIdleMountsEmpty: z.boolean(),
    warmIdleSessionCount: z.number().int().safe().nonnegative(),
    warmIdleRestartCount: z.number().int().safe().nonnegative(),
    warmIdleOomCount: z.number().int().safe().nonnegative(),
  })
  .strict()

export type ShmTmpfsCapacityInput = Readonly<z.infer<typeof ShmTmpfsCapacityInputSchema>>

export function requiredManagedEphemeralBytes(input: ShmTmpfsCapacityInput): number {
  return (
    input.manager.tmpfsLimitBytes +
    MANAGED_DEPLOYMENT_CONFIG.activeWorkerCount *
      (input.worker.shmLimitBytes +
        input.worker.runTmpfsBytes +
        input.worker.tmpTmpfsBytes +
        input.worker.profileTmpfsBytes)
  )
}

export function evaluateShmTmpfsCapacity(input: unknown): CapacityGateResult {
  const parsed = ShmTmpfsCapacityInputSchema.safeParse(input)
  if (!parsed.success) return CAPACITY_GATE_RESULT.BLOCKED_MEASUREMENT
  const { manager, worker } = parsed.data
  const managerRetainedBytes = manager.baseP95Bytes + manager.tmpfsLimitBytes + manager.otherReservedBytes
  const workerRetainedBytes =
    worker.baseP95Bytes +
    worker.shmLimitBytes +
    worker.runTmpfsBytes +
    worker.tmpTmpfsBytes +
    worker.profileTmpfsBytes
  const managerAllowedBytes = Math.floor(MANAGED_DEPLOYMENT_CONFIG.capacityUtilizationRatio * manager.limitBytes)
  const workerAllowedBytes = Math.floor(MANAGED_DEPLOYMENT_CONFIG.capacityUtilizationRatio * worker.limitBytes)
  const measuredWorkerBaseP95Bytes = Math.max(...worker.baseP95BytesByWorker)
  const composeSizesMatch =
    manager.actualTmpfsLimitBytes === manager.signedTmpfsLimitBytes &&
    manager.tmpfsLimitBytes === manager.signedTmpfsLimitBytes &&
    worker.actualShmLimitBytes === worker.shmLimitBytes &&
    worker.actualRunTmpfsBytes === worker.runTmpfsBytes &&
    worker.actualTmpTmpfsBytes === worker.tmpTmpfsBytes &&
    worker.actualProfileTmpfsBytes === worker.profileTmpfsBytes
  const releaseSizesMatch =
    worker.shmLimitBytes === worker.signedShmLimitBytes &&
    worker.runTmpfsBytes === worker.signedRunTmpfsBytes &&
    worker.tmpTmpfsBytes === worker.signedTmpTmpfsBytes &&
    worker.profileTmpfsBytes === worker.signedProfileTmpfsBytes
  const warmIdleMeasurementComplete =
    parsed.data.warmIdleUsableSamplesByWorker.every(
      (samples) => samples === MANAGED_DEPLOYMENT_CONFIG.capacitySampleCount,
    ) &&
    parsed.data.warmIdleSampleIntervalSeconds === MANAGED_DEPLOYMENT_CONFIG.capacitySampleIntervalSeconds &&
    parsed.data.warmIdleMountsEmpty &&
    parsed.data.warmIdleSessionCount === 0 &&
    parsed.data.warmIdleRestartCount === 0 &&
    parsed.data.warmIdleOomCount === 0
  if (
    !parsed.data.measurementFresh ||
    !parsed.data.mountsBounded ||
    !composeSizesMatch ||
    !releaseSizesMatch ||
    !warmIdleMeasurementComplete ||
    manager.baseP95Bytes === 0 ||
    worker.baseP95Bytes !== measuredWorkerBaseP95Bytes ||
    managerRetainedBytes > managerAllowedBytes ||
    workerRetainedBytes > workerAllowedBytes
  ) {
    return CAPACITY_GATE_RESULT.BLOCKED_SHM_TMPFS
  }
  return CAPACITY_GATE_RESULT.VERIFIED
}

export const PressureCapacityInputSchema = z
  .object({
    baselineUsableSamples: z.number().int().safe().nonnegative(),
    pressureUsableSamples: z.number().int().safe().nonnegative(),
    pressureWindowSeconds: z.number().finite().nonnegative(),
    sampleIntervalSeconds: z.number().finite().nonnegative(),
    sessionOverlapMs: z.number().finite().nonnegative(),
    workerLoopMaxIntervalSeconds: z.tuple([
      z.number().finite().nonnegative(),
      z.number().finite().nonnegative(),
    ]),
    oomCount: z.number().int().safe().nonnegative(),
    oomKillCount: z.number().int().safe().nonnegative(),
    restartCount: z.number().int().safe().nonnegative(),
    failedHealthProbeCount: z.number().int().safe().nonnegative(),
    memoryThresholdsVerified: z.boolean(),
    cpuThresholdsVerified: z.boolean(),
    diskThresholdsVerified: z.boolean(),
    inodeThresholdsVerified: z.boolean(),
  })
  .strict()

export type PressureCapacityInput = Readonly<z.infer<typeof PressureCapacityInputSchema>>

export function evaluatePressureCapacity(input: unknown): CapacityGateResult {
  const parsed = PressureCapacityInputSchema.safeParse(input)
  if (!parsed.success) return CAPACITY_GATE_RESULT.BLOCKED_MEASUREMENT
  const pressure = parsed.data
  if (
    pressure.baselineUsableSamples !== MANAGED_DEPLOYMENT_CONFIG.capacitySampleCount ||
    pressure.pressureUsableSamples !== MANAGED_DEPLOYMENT_CONFIG.capacitySampleCount ||
    pressure.pressureWindowSeconds !== MANAGED_DEPLOYMENT_CONFIG.capacityWindowSeconds ||
    pressure.sampleIntervalSeconds !== MANAGED_DEPLOYMENT_CONFIG.capacitySampleIntervalSeconds
  ) {
    return CAPACITY_GATE_RESULT.BLOCKED_MEASUREMENT
  }
  const workerLoopMissed = pressure.workerLoopMaxIntervalSeconds.some(
    (interval) => interval > MANAGED_DEPLOYMENT_CONFIG.workerPressureLoopSeconds,
  )
  if (
    pressure.sessionOverlapMs < MANAGED_DEPLOYMENT_CONFIG.handoverOverlapMs ||
    workerLoopMissed ||
    pressure.oomCount !== 0 ||
    pressure.oomKillCount !== 0 ||
    pressure.restartCount !== 0 ||
    pressure.failedHealthProbeCount !== 0 ||
    !pressure.memoryThresholdsVerified ||
    !pressure.cpuThresholdsVerified ||
    !pressure.diskThresholdsVerified ||
    !pressure.inodeThresholdsVerified
  ) {
    return CAPACITY_GATE_RESULT.BLOCKED_PRESSURE
  }
  return CAPACITY_GATE_RESULT.VERIFIED
}
