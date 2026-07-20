import { describe, expect, it } from "vitest"
import {
  AllocationIdSchema,
  EventLedger,
  GatewayEventType,
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
  publicSessionId,
  upstreamSessionId,
  workerDescriptor,
} from "./test-support.js"

describe("WorkerRegistry observation transitions", () => {
  it("marks a replaced live session lost before replacement and observation events", () => {
    // Given
    const clock = new FakeClock()
    const ledger = new EventLedger({ clock })
    const registry = new WorkerRegistry({ clock, ledger })
    const workerId = WorkerIdSchema.parse("worker-00")
    const sessionId = publicSessionId(1)
    const firstObservation = registry.beginObservation(workerId)
    registry.commitObservation(firstObservation, {
      worker: workerDescriptor(0, 1),
      remoteState: WorkerRemoteState.IDLE,
      sessions: [],
    })
    const allocationId = AllocationIdSchema.parse("allocation-1")
    registry.reserveNext(allocationId)
    registry.bindSession({
      allocationId,
      publicSessionId: sessionId,
      upstreamSessionId: upstreamSessionId(1),
    })

    // When
    const replacement = registry.beginObservation(workerId)
    registry.commitObservation(replacement, {
      worker: workerDescriptor(0, 2),
      remoteState: WorkerRemoteState.IDLE,
      sessions: [],
    })

    // Then
    expect(registry.session(sessionId)?.state).toBe(SessionState.LOST)
    expect(ledger.readAfter().map(({ type }) => type).slice(-3)).toEqual([
      GatewayEventType.SESSION_LOST,
      GatewayEventType.WORKER_REPLACED,
      GatewayEventType.WORKER_OBSERVED,
    ])
  })

  it("recovers exactly one fully identified busy session", () => {
    // Given
    const clock = new FakeClock()
    const registry = new WorkerRegistry({ clock, ledger: new EventLedger({ clock }) })
    const workerId = WorkerIdSchema.parse("worker-00")
    const sessionId = publicSessionId(1)

    // When
    registry.commitObservation(registry.beginObservation(workerId), {
      worker: workerDescriptor(0, 1),
      remoteState: WorkerRemoteState.BUSY,
      sessions: [
        {
          allocationId: AllocationIdSchema.parse("allocation-1"),
          publicSessionId: sessionId,
          upstreamSessionId: upstreamSessionId(1),
        },
      ],
    })

    // Then
    expect(registry.workers()[0]?.state).toBe(WorkerState.LIVE)
    expect(registry.session(sessionId)?.state).toBe(SessionState.LIVE)
  })

  it("quarantines a busy observation without exactly one recoverable session", () => {
    // Given
    const clock = new FakeClock()
    const registry = new WorkerRegistry({ clock, ledger: new EventLedger({ clock }) })
    const workerId = WorkerIdSchema.parse("worker-00")

    // When
    registry.commitObservation(registry.beginObservation(workerId), {
      worker: workerDescriptor(0, 1),
      remoteState: WorkerRemoteState.BUSY,
      sessions: [],
    })

    // Then
    expect(registry.workers()[0]?.state).toBe(WorkerState.QUARANTINED)
  })

  it("rejects a replaced generation when resolving a lost session worker", () => {
    // Given
    const clock = new FakeClock()
    const registry = new WorkerRegistry({ clock, ledger: new EventLedger({ clock }) })
    const workerId = WorkerIdSchema.parse("worker-00")
    const sessionId = publicSessionId(1)
    registry.commitObservation(registry.beginObservation(workerId), {
      worker: workerDescriptor(0, 1),
      remoteState: WorkerRemoteState.IDLE,
      sessions: [],
    })
    const allocationId = AllocationIdSchema.parse("allocation-1")
    registry.reserveNext(allocationId)
    registry.bindSession({
      allocationId,
      publicSessionId: sessionId,
      upstreamSessionId: upstreamSessionId(1),
    })
    registry.commitObservation(registry.beginObservation(workerId), {
      worker: workerDescriptor(0, 2),
      remoteState: WorkerRemoteState.IDLE,
      sessions: [],
    })

    // When
    const resolveLostWorker = () => registry.workerForSession(sessionId)

    // Then
    expect(resolveLostWorker).toThrow(StaleWorkerGenerationError)
  })

  it("rejects an observation that started before a local reservation", () => {
    // Given
    const clock = new FakeClock()
    const registry = new WorkerRegistry({ clock, ledger: new EventLedger({ clock }) })
    const workerId = WorkerIdSchema.parse("worker-00")
    registry.commitObservation(registry.beginObservation(workerId), {
      worker: workerDescriptor(0, 1),
      remoteState: WorkerRemoteState.IDLE,
      sessions: [],
    })
    const staleObservation = registry.beginObservation(workerId)
    const allocationId = AllocationIdSchema.parse("allocation-1")
    registry.reserveNext(allocationId)

    // When
    const committed = registry.commitObservation(staleObservation, {
      worker: workerDescriptor(0, 1),
      remoteState: WorkerRemoteState.IDLE,
      sessions: [],
    })

    // Then
    expect(committed.kind).toBe(ObservationCommitKind.STALE_OBSERVATION)
    expect(registry.workers()[0]?.state).toBe(WorkerState.RESERVED)
  })
})
