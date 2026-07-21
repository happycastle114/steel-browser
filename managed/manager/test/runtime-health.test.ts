import { describe, expect, it } from "vitest"
import { ReadinessState, RuntimeHealth } from "../src/health/runtime-health.js"

describe("RuntimeHealth", () => {
  it("requires initialization and a successful reconciliation", () => {
    // Given
    const health = new RuntimeHealth()

    // When / Then
    expect(health.snapshot()).toMatchObject({
      live: true,
      ready: false,
      readiness: ReadinessState.NOT_INITIALIZED,
    })
    health.markInitialized()
    expect(health.snapshot().readiness).toBe(ReadinessState.WAITING_FOR_RECONCILE)
    health.recordReconciliation(true)
    expect(health.snapshot()).toMatchObject({ ready: true, readiness: ReadinessState.READY })
  })

  it("uses exactly two grace intervals after a previously reachable worker", () => {
    // Given
    const health = new RuntimeHealth()
    health.markInitialized()
    health.recordReconciliation(true)

    // When / Then
    health.recordReconciliation(false)
    expect(health.snapshot().readiness).toBe(ReadinessState.RECONCILE_GRACE)
    health.recordReconciliation(false)
    expect(health.snapshot().readiness).toBe(ReadinessState.RECONCILE_GRACE)
    health.recordReconciliation(false)
    expect(health.snapshot()).toMatchObject({
      ready: false,
      readiness: ReadinessState.UNREACHABLE,
      consecutiveUnreachableIntervals: 3,
    })
  })

  it("does not grant startup grace and becomes unready while stopping", () => {
    // Given
    const startup = new RuntimeHealth()
    startup.markInitialized()

    // When / Then
    startup.recordReconciliation(false)
    expect(startup.snapshot().ready).toBe(false)
    startup.recordReconciliation(true)
    startup.markStopping()
    expect(startup.snapshot().readiness).toBe(ReadinessState.STOPPING)
  })
})
