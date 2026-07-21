import { WorkerState } from "@happycastle/steel-managed-gateway"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RuntimeHealth } from "../src/health/runtime-health.js"
import { ReconciliationLoop } from "../src/runtime/reconciliation-loop.js"

describe("ReconciliationLoop", () => {
  afterEach(() => vi.useRealTimers())

  it("coalesces concurrent cycles and drains at most one ticket per worker", async () => {
    // Given
    let finishReconcile: (() => void) | undefined
    const reconciliation = new Promise<void>((resolve) => {
      finishReconcile = resolve
    })
    const workers = [{ state: WorkerState.IDLE }, { state: WorkerState.LIVE }]
    const processNext = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({})
    const run = vi.fn().mockReturnValue(reconciliation)
    const health = new RuntimeHealth()
    health.markInitialized()
    const loop = new ReconciliationLoop({
      admissions: { processNext },
      health,
      intervalMilliseconds: 5_000,
      onError: vi.fn(),
      reconciler: { run },
      registry: { workers: () => workers },
    })

    // When
    const first = loop.runNow()
    const second = loop.runNow()
    finishReconcile?.()
    await Promise.all([first, second])

    // Then
    expect(run).toHaveBeenCalledOnce()
    expect(processNext).toHaveBeenCalledTimes(2)
    expect(health.snapshot().ready).toBe(true)
    await loop.stop()
  })

  it("records failed intervals without overlapping scheduled runs", async () => {
    // Given
    vi.useFakeTimers()
    const error = new Error("probe failed")
    const onError = vi.fn()
    const run = vi.fn().mockRejectedValue(error)
    const health = new RuntimeHealth()
    health.markInitialized()
    const loop = new ReconciliationLoop({
      admissions: { processNext: vi.fn() },
      health,
      intervalMilliseconds: 1_000,
      onError,
      reconciler: { run },
      registry: { workers: () => [] },
    })

    // When
    loop.start()
    await vi.advanceTimersByTimeAsync(2_001)

    // Then
    expect(run).toHaveBeenCalledTimes(3)
    expect(onError).toHaveBeenCalledTimes(3)
    expect(health.snapshot()).toMatchObject({
      ready: false,
      consecutiveUnreachableIntervals: 3,
    })
    await loop.stop()
  })
})
