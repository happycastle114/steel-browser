import { describe, expect, it } from "vitest"
import {
  AllocationIdSchema,
  EventLedger,
  GatewayEventType,
  WorkerIdSchema,
  WorkerRegistry,
  WorkerRemoteState,
  WorkerState,
} from "../src/index.js"
import { FakeClock, workerDescriptor } from "./test-support.js"

describe("WorkerRegistry reservation transitions", () => {
  it("cancels an internal reservation without quarantining a proven idle worker", () => {
    // Given
    const clock = new FakeClock()
    const registry = new WorkerRegistry({ clock, ledger: new EventLedger({ clock }) })
    const workerId = WorkerIdSchema.parse("worker-00")
    registry.commitObservation(registry.beginObservation(workerId), {
      worker: workerDescriptor(0, 1),
      remoteState: WorkerRemoteState.IDLE,
      sessions: [],
    })
    const allocationId = AllocationIdSchema.parse("allocation-1")
    registry.reserveNext(allocationId)

    // When
    registry.cancelReservation(allocationId)

    // Then
    expect(registry.workers()[0]?.state).toBe(WorkerState.IDLE)
  })

  it("quarantines a failed allocation and records one redacted event", () => {
    // Given
    const clock = new FakeClock()
    const ledger = new EventLedger({ clock })
    const registry = new WorkerRegistry({ clock, ledger })
    const workerId = WorkerIdSchema.parse("worker-00")
    registry.commitObservation(registry.beginObservation(workerId), {
      worker: workerDescriptor(0, 1),
      remoteState: WorkerRemoteState.IDLE,
      sessions: [],
    })
    const allocationId = AllocationIdSchema.parse("allocation-1")
    registry.reserveNext(allocationId)

    // When
    registry.quarantineReservation(allocationId)

    // Then
    expect(registry.workers()[0]?.state).toBe(WorkerState.QUARANTINED)
    expect(ledger.readAfter().at(-1)?.type).toBe(GatewayEventType.WORKER_QUARANTINED)
  })
})
