import { describe, expect, it } from "vitest"

import {
  CAPACITY_GATE_OUTCOME,
  CAPACITY_PHASE,
  DISK_CAPACITY_STAGE,
  INODE_CAPACITY_STAGE,
  MANAGED_DEPLOYMENT_CONFIG,
  evaluateCpuCapacity,
  evaluateDiskCapacity,
  evaluateInodeCapacity,
  evaluateMemoryCapacity,
  evaluatePressureCapacity,
  evaluateShmTmpfsCapacity,
  requiredManagedEphemeralBytes,
  requiredManagedMemoryMiB,
} from "../src/managed-overlay.js"
import {
  validPressureCapacity,
  validShmTmpfsCapacity,
} from "./deployment-topology-fixtures.js"

const MIB = 1_048_576
const GIB = 1_073_741_824

describe("deployment-topology exact capacity boundaries", () => {
  it("ceil-counts manager and two worker cgroup limits without adding ephemeral bytes", () => {
    // Given: byte limits that each cross a MiB boundary independently.
    const input = { managerLimitBytes: MIB + 1, workerLimitBytes: 1 }

    // When: required managed memory is calculated.
    const result = requiredManagedMemoryMiB(input)

    // Then: the manager is two MiB and both workers are one MiB each.
    expect(result).toBe(4)
  })

  it.each([
    [CAPACITY_PHASE.DISPOSABLE_CANARY, 2_523, 100],
    [CAPACITY_PHASE.PRODUCTION_SERIAL, 2_423, 100],
  ])("accepts memory equality and rejects one MiB below for %s", (phase, hostTotalMemoryMiB, legacySteelP95MiB) => {
    // Given: required memory exactly equals the phase-specific 80 percent host allowance.
    const exact = {
      phase,
      hostTotalMemoryMiB,
      hostNonSteelP95MiB: 0,
      legacySteelP95MiB,
      managerLimitBytes: 100 * MIB,
      workerLimitBytes: 100 * MIB,
      usableSamples: 300,
      sampleWindowSeconds: 300,
      sampleIntervalSeconds: 1,
    }

    // When: exact, one-MiB-lower, and missing-sample host inputs are evaluated.
    const outcomes = [
      evaluateMemoryCapacity(exact),
      evaluateMemoryCapacity({ ...exact, hostTotalMemoryMiB: hostTotalMemoryMiB - 1 }),
      evaluateMemoryCapacity({ ...exact, usableSamples: 299 }),
    ]

    // Then: equality passes, the lower budget blocks memory, and missing data blocks measurement.
    expect(outcomes.map((result) => result.outcome)).toEqual([
      CAPACITY_GATE_OUTCOME.VERIFIED,
      CAPACITY_GATE_OUTCOME.BLOCKED_MEMORY,
      CAPACITY_GATE_OUTCOME.BLOCKED_MEASUREMENT,
    ])
  })

  it.each([
    [CAPACITY_PHASE.DISPOSABLE_CANARY, 4, 0.5, 1.6],
    [CAPACITY_PHASE.PRODUCTION_SERIAL, 4, 0.5, 2],
  ])("enforces CPU p95, load, and throttle equality for %s", (phase, hostLogicalCpuCount, legacySteelCpuP95Cores, managedCpuP95Cores) => {
    // Given: all three CPU predicates exactly meet their phase-specific limits.
    const exact = {
      phase,
      hostLogicalCpuCount,
      hostNonSteelCpuP95Cores: 1,
      legacySteelCpuP95Cores,
      managedCpuP95Cores,
      loadOneP95: 3.2,
      usableSamples: 300,
      sampleWindowSeconds: 300,
      sampleIntervalSeconds: 1,
      throttling: [
        { nrThrottled: 5, nrPeriods: 100 },
        { nrThrottled: 5, nrPeriods: 100 },
        { nrThrottled: 5, nrPeriods: 100 },
      ],
    }

    // When: exact, p95-over, load-over, throttle-over, and incomplete observations are evaluated.
    const outcomes = [
      evaluateCpuCapacity(exact),
      evaluateCpuCapacity({ ...exact, managedCpuP95Cores: managedCpuP95Cores + 0.000_001 }),
      evaluateCpuCapacity({ ...exact, loadOneP95: 3.200_001 }),
      evaluateCpuCapacity({ ...exact, throttling: [{ nrThrottled: 6, nrPeriods: 100 }, ...exact.throttling.slice(1)] }),
      evaluateCpuCapacity({ ...exact, sampleWindowSeconds: 299 }),
    ]

    // Then: equality passes; over-bound observations block CPU and incomplete evidence blocks measurement.
    expect(outcomes.map((result) => result.outcome)).toEqual([
      CAPACITY_GATE_OUTCOME.VERIFIED,
      CAPACITY_GATE_OUTCOME.BLOCKED_CPU,
      CAPACITY_GATE_OUTCOME.BLOCKED_CPU,
      CAPACITY_GATE_OUTCOME.BLOCKED_CPU,
      CAPACITY_GATE_OUTCOME.BLOCKED_MEASUREMENT,
    ])
  })

  it("enforces exact pre-pull and post-start disk boundaries", () => {
    // Given: byte-for-byte reserve inputs and a filesystem whose 20 percent floor exceeds 5 GiB.
    const before = {
      stage: DISK_CAPACITY_STAGE.BEFORE_PULLS,
      freeDiskBytes: 5 * GIB + 2 * (100 + 2 * 200) + 300 + 400,
      filesystemBytes: 30 * GIB,
      managerImageSizeBytes: 100,
      workerImageSizeBytes: 200,
      legacyRollbackLayerBytes: 300,
      signedReceiptBundleBytes: 400,
    }
    const after = { ...before, stage: DISK_CAPACITY_STAGE.AFTER_START, freeDiskBytes: 6 * GIB }

    // When: equality and one-byte-under values are evaluated for both stages.
    const outcomes = [
      evaluateDiskCapacity(before),
      evaluateDiskCapacity({ ...before, freeDiskBytes: before.freeDiskBytes - 1 }),
      evaluateDiskCapacity(after),
      evaluateDiskCapacity({ ...after, freeDiskBytes: after.freeDiskBytes - 1 }),
    ]

    // Then: exact values pass and one byte below returns the disk blocker.
    expect(outcomes.map((result) => result.outcome)).toEqual([
      CAPACITY_GATE_OUTCOME.VERIFIED,
      CAPACITY_GATE_OUTCOME.BLOCKED_DISK,
      CAPACITY_GATE_OUTCOME.VERIFIED,
      CAPACITY_GATE_OUTCOME.BLOCKED_DISK,
    ])
  })

  it("enforces exact pre-pull and post-start inode boundaries", () => {
    // Given: exact reserve inputs and a post-start 10 percent floor above 100000.
    const before = {
      stage: INODE_CAPACITY_STAGE.BEFORE_PULLS,
      freeInodes: 100_000 + 2 * (100 + 2 * 200) + 300,
      totalInodes: 2_000_000,
      managerImageInodes: 100,
      workerImageInodes: 200,
      legacyRollbackInodes: 300,
    }
    const after = { ...before, stage: INODE_CAPACITY_STAGE.AFTER_START, freeInodes: 200_000 }

    // When: equality and one-inode-under values are evaluated for both stages.
    const outcomes = [
      evaluateInodeCapacity(before),
      evaluateInodeCapacity({ ...before, freeInodes: before.freeInodes - 1 }),
      evaluateInodeCapacity(after),
      evaluateInodeCapacity({ ...after, freeInodes: after.freeInodes - 1 }),
    ]

    // Then: exact values pass and one inode below returns the inode blocker.
    expect(outcomes.map((result) => result.outcome)).toEqual([
      CAPACITY_GATE_OUTCOME.VERIFIED,
      CAPACITY_GATE_OUTCOME.BLOCKED_INODES,
      CAPACITY_GATE_OUTCOME.VERIFIED,
      CAPACITY_GATE_OUTCOME.BLOCKED_INODES,
    ])
  })

  it("enforces signed shm and tmpfs equality plus both 80 percent cgroup bounds", () => {
    // Given: manager and worker retained bytes exactly equal 80 percent of each limit.
    const exact = validShmTmpfsCapacity()

    // When: exact, manager-over, worker-over, signed-size-drift, and p95-derivation inputs are evaluated.
    const outcomes = [
      evaluateShmTmpfsCapacity(exact),
      evaluateShmTmpfsCapacity({ ...exact, manager: { ...exact.manager, baseP95Bytes: 401 } }),
      evaluateShmTmpfsCapacity({ ...exact, worker: { ...exact.worker, baseP95Bytes: 401 } }),
      evaluateShmTmpfsCapacity({ ...exact, worker: { ...exact.worker, actualShmLimitBytes: 99 } }),
      evaluateShmTmpfsCapacity({ ...exact, worker: { ...exact.worker, signedProfileTmpfsBytes: 99 } }),
      evaluateShmTmpfsCapacity({ ...exact, worker: { ...exact.worker, baseP95BytesByWorker: [400, 401] } }),
    ]

    // Then: equality passes and every over/drift case has the shm/tmpfs blocker.
    expect(outcomes.map((result) => result.outcome)).toEqual([
      CAPACITY_GATE_OUTCOME.VERIFIED,
      CAPACITY_GATE_OUTCOME.BLOCKED_SHM_TMPFS,
      CAPACITY_GATE_OUTCOME.BLOCKED_SHM_TMPFS,
      CAPACITY_GATE_OUTCOME.BLOCKED_SHM_TMPFS,
      CAPACITY_GATE_OUTCOME.BLOCKED_SHM_TMPFS,
      CAPACITY_GATE_OUTCOME.BLOCKED_SHM_TMPFS,
    ])
    expect(requiredManagedEphemeralBytes(exact)).toBe(1_000)
  })

  it("enforces the exact 300-second pressure window and five-second overlap", () => {
    // Given: a complete 300-sample run at every exact pressure boundary.
    const exact = validPressureCapacity()

    // When: exact, missing-sample, short-overlap, slow-loop, and restart inputs are evaluated.
    const outcomes = [
      evaluatePressureCapacity(exact),
      evaluatePressureCapacity({ ...exact, pressureUsableSamples: 299 }),
      evaluatePressureCapacity({ ...exact, sessionOverlapMs: 4_999 }),
      evaluatePressureCapacity({ ...exact, workerLoopMaxIntervalSeconds: [10, 10.001] }),
      evaluatePressureCapacity({ ...exact, restartCount: 1 }),
    ]

    // Then: exact passes, missing data is measurement-blocked, and pressure drift is pressure-blocked.
    expect(outcomes.map((result) => result.outcome)).toEqual([
      CAPACITY_GATE_OUTCOME.VERIFIED,
      CAPACITY_GATE_OUTCOME.BLOCKED_MEASUREMENT,
      CAPACITY_GATE_OUTCOME.BLOCKED_PRESSURE,
      CAPACITY_GATE_OUTCOME.BLOCKED_PRESSURE,
      CAPACITY_GATE_OUTCOME.BLOCKED_PRESSURE,
    ])
  })

  it("keeps fixed counts and timeout-like boundaries in typed config", () => {
    // Given: the canonical topology configuration object.
    const config = MANAGED_DEPLOYMENT_CONFIG

    // When: its fixed operational values are observed.
    const values = [
      config.maxConcurrentManagedProjects,
      config.activeWorkerCount,
      config.capacitySampleCount,
      config.capacityWindowSeconds,
      config.handoverOverlapMs,
    ]

    // Then: the approved constants are exposed once through the config API.
    expect(values).toEqual([1, 2, 300, 300, 5_000])
  })
})
