import { describe, expect, it } from "vitest"
import {
  AllocationIdSchema,
  EventLedger,
  SessionState,
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

describe("WorkerRegistry recovery conflicts", () => {
  it("terminalizes a live session before an unreachable worker can become idle", () => {
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

    // When
    registry.commitUnreachable(registry.beginObservation(workerId))
    registry.commitObservation(registry.beginObservation(workerId), {
      worker: workerDescriptor(0, 1),
      remoteState: WorkerRemoteState.IDLE,
      sessions: [],
    })

    // Then
    expect(registry.workers()[0]?.state).toBe(WorkerState.IDLE)
    expect(registry.session(sessionId)?.state).toBe(SessionState.LOST)
    expect(registry.liveSessionIds()).toEqual([])
  })

  it("restores the exact same-generation session after a transient unreachable probe", () => {
    // Given
    const clock = new FakeClock()
    const registry = new WorkerRegistry({ clock, ledger: new EventLedger({ clock }) })
    const workerId = WorkerIdSchema.parse("worker-00")
    const sessionId = publicSessionId(1)
    const allocationId = AllocationIdSchema.parse("allocation-1")
    registry.commitObservation(registry.beginObservation(workerId), {
      worker: workerDescriptor(0, 1),
      remoteState: WorkerRemoteState.IDLE,
      sessions: [],
    })
    registry.reserveNext(allocationId)
    registry.bindSession({
      allocationId,
      publicSessionId: sessionId,
      upstreamSessionId: upstreamSessionId(1),
    })
    registry.commitUnreachable(registry.beginObservation(workerId))

    // When
    registry.commitObservation(registry.beginObservation(workerId), {
      worker: workerDescriptor(0, 1),
      remoteState: WorkerRemoteState.BUSY,
      sessions: [
        {
          allocationId: AllocationIdSchema.parse("allocation-recovered-different"),
          publicSessionId: sessionId,
          upstreamSessionId: upstreamSessionId(1),
        },
      ],
    })

    // Then
    expect(registry.workers()[0]?.state).toBe(WorkerState.LIVE)
    expect(registry.session(sessionId)?.state).toBe(SessionState.LIVE)
    expect(registry.session(sessionId)?.allocationId).toBe(allocationId)
  })

  it("quarantines a sibling that reports an incumbent public session id", () => {
    // Given
    const clock = new FakeClock()
    const registry = new WorkerRegistry({ clock, ledger: new EventLedger({ clock }) })
    const firstWorkerId = WorkerIdSchema.parse("worker-00")
    const secondWorkerId = WorkerIdSchema.parse("worker-01")
    for (const [workerId, worker] of [
      [firstWorkerId, workerDescriptor(0, 1)],
      [secondWorkerId, workerDescriptor(1, 1)],
    ] as const) {
      registry.commitObservation(registry.beginObservation(workerId), {
        worker,
        remoteState: WorkerRemoteState.IDLE,
        sessions: [],
      })
    }
    const incumbentSessionId = publicSessionId(1)
    const incumbentAllocationId = AllocationIdSchema.parse("allocation-1")
    registry.reserveNext(incumbentAllocationId)
    registry.bindSession({
      allocationId: incumbentAllocationId,
      publicSessionId: incumbentSessionId,
      upstreamSessionId: upstreamSessionId(1),
    })

    // When
    registry.commitObservation(registry.beginObservation(secondWorkerId), {
      worker: workerDescriptor(1, 1),
      remoteState: WorkerRemoteState.BUSY,
      sessions: [
        {
          allocationId: AllocationIdSchema.parse("allocation-2"),
          publicSessionId: incumbentSessionId,
          upstreamSessionId: upstreamSessionId(1),
        },
      ],
    })

    // Then
    expect(registry.workers().map(({ state }) => state)).toEqual([
      WorkerState.LIVE,
      WorkerState.QUARANTINED,
    ])
    expect(registry.session(incumbentSessionId)?.workerId).toBe(firstWorkerId)
  })

  it("quarantines a same-generation worker that contradicts its live binding", () => {
    // Given
    const clock = new FakeClock()
    const registry = new WorkerRegistry({ clock, ledger: new EventLedger({ clock }) })
    const workerId = WorkerIdSchema.parse("worker-00")
    const originalSessionId = publicSessionId(1)
    registry.commitObservation(registry.beginObservation(workerId), {
      worker: workerDescriptor(0, 1),
      remoteState: WorkerRemoteState.IDLE,
      sessions: [],
    })
    const allocationId = AllocationIdSchema.parse("allocation-1")
    registry.reserveNext(allocationId)
    registry.bindSession({
      allocationId,
      publicSessionId: originalSessionId,
      upstreamSessionId: upstreamSessionId(1),
    })

    // When
    registry.commitObservation(registry.beginObservation(workerId), {
      worker: workerDescriptor(0, 1),
      remoteState: WorkerRemoteState.BUSY,
      sessions: [
        {
          allocationId: AllocationIdSchema.parse("allocation-2"),
          publicSessionId: publicSessionId(2),
          upstreamSessionId: upstreamSessionId(2),
        },
      ],
    })

    // Then
    expect(registry.workers()[0]?.state).toBe(WorkerState.QUARANTINED)
    expect(registry.session(originalSessionId)?.state).toBe(SessionState.LOST)
    expect(registry.session(publicSessionId(2))).toBeUndefined()
  })

  it("rejects recovery that reuses a terminal session allocation", () => {
    const clock = new FakeClock()
    const registry = new WorkerRegistry({ clock, ledger: new EventLedger({ clock }) })
    const workerId = WorkerIdSchema.parse("worker-00")
    const worker = workerDescriptor(0, 1)
    registry.commitObservation(registry.beginObservation(workerId), {
      worker,
      remoteState: WorkerRemoteState.IDLE,
      sessions: [],
    })
    const allocationId = AllocationIdSchema.parse("allocation-1")
    const terminalSessionId = publicSessionId(1)
    registry.reserveNext(allocationId)
    registry.bindSession({
      allocationId,
      publicSessionId: terminalSessionId,
      upstreamSessionId: upstreamSessionId(1),
    })
    registry.beginRelease(terminalSessionId)
    registry.reconcileReleased(terminalSessionId, worker)
    const recoveredSessionId = publicSessionId(2)

    registry.commitObservation(registry.beginObservation(workerId), {
      worker,
      remoteState: WorkerRemoteState.BUSY,
      sessions: [
        {
          allocationId,
          publicSessionId: recoveredSessionId,
          upstreamSessionId: upstreamSessionId(2),
        },
      ],
    })

    expect(registry.workers()[0]?.state).toBe(WorkerState.QUARANTINED)
    expect(registry.session(terminalSessionId)?.state).toBe(SessionState.RELEASED)
    expect(registry.session(recoveredSessionId)).toBeUndefined()
    expect(registry.snapshot().sessions).toHaveLength(1)
  })
})
