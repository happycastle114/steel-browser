import { describe, expect, it } from "vitest"
import {
  AllocationIdSchema,
  EventLedger,
  ObservationCommitKind,
  SessionState,
  StaleWorkerGenerationError,
  WorkerIdSchema,
  WorkerRegistry,
  WorkerRemoteState,
  WorkerState,
} from "../src/index.js"
import {
  FakeClock,
  instanceId,
  publicSessionId,
  upstreamSessionId,
  workerDescriptor,
} from "./test-support.js"

describe("WorkerRegistry", () => {
  it("reserves, binds, and frees only after exact-generation idle reconciliation", () => {
    // Given
    const clock = new FakeClock()
    const registry = new WorkerRegistry({ clock, ledger: new EventLedger({ clock }) })
    const workerId = WorkerIdSchema.parse("worker-00")
    const allocationId = AllocationIdSchema.parse("allocation-1")
    const sessionId = publicSessionId(1)
    const upstreamId = upstreamSessionId(1)
    const observation = registry.beginObservation(workerId)
    const worker = workerDescriptor(0, 1)
    registry.commitObservation(observation, {
      worker,
      remoteState: WorkerRemoteState.IDLE,
      sessions: [],
    })

    // When
    const reserved = registry.reserveNext(allocationId)
    registry.bindSession({ allocationId, publicSessionId: sessionId, upstreamSessionId: upstreamId })
    registry.beginRelease(sessionId)
    registry.reconcileReleased(sessionId, worker)

    // Then
    expect(reserved).toEqual(worker)
    expect(registry.session(sessionId)?.state).toBe(SessionState.RELEASED)
    expect(registry.workers()[0]?.state).toBe(WorkerState.IDLE)
  })

  it("does not let a late old-instance release mutate its replacement", () => {
    // Given
    const clock = new FakeClock()
    const registry = new WorkerRegistry({ clock, ledger: new EventLedger({ clock }) })
    const workerId = WorkerIdSchema.parse("worker-00")
    const oldWorker = workerDescriptor(0, 1)
    const oldObservation = registry.beginObservation(workerId)
    registry.commitObservation(oldObservation, {
      worker: oldWorker,
      remoteState: WorkerRemoteState.IDLE,
      sessions: [],
    })
    const newObservation = registry.beginObservation(workerId)
    registry.commitObservation(newObservation, {
      worker: workerDescriptor(0, 2),
      remoteState: WorkerRemoteState.IDLE,
      sessions: [],
    })

    // When
    const reconcileOldGeneration = () =>
      registry.reconcileReleased(publicSessionId(999), oldWorker)

    // Then
    expect(reconcileOldGeneration).toThrow(StaleWorkerGenerationError)
    expect(registry.workers()[0]?.instanceId).toBe(instanceId(2))
    expect(registry.workers()[0]?.state).toBe(WorkerState.IDLE)
  })

  it("ignores an observation that completes after a newer probe started", () => {
    // Given
    const clock = new FakeClock()
    const registry = new WorkerRegistry({ clock, ledger: new EventLedger({ clock }) })
    const workerId = WorkerIdSchema.parse("worker-00")
    const late = registry.beginObservation(workerId)
    const current = registry.beginObservation(workerId)

    // When
    const lateResult = registry.commitObservation(late, {
      worker: workerDescriptor(0, 1),
      remoteState: WorkerRemoteState.IDLE,
      sessions: [],
    })
    const currentResult = registry.commitObservation(current, {
      worker: workerDescriptor(0, 2),
      remoteState: WorkerRemoteState.IDLE,
      sessions: [],
    })

    // Then
    expect(lateResult.kind).toBe(ObservationCommitKind.STALE_OBSERVATION)
    expect(currentResult.kind).toBe(ObservationCommitKind.COMMITTED)
    expect(registry.workers()[0]?.instanceId).toBe(instanceId(2))
  })
})
