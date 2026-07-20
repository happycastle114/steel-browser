import { describe, expect, it } from "vitest"
import {
  EventLedger,
  GatewayEventType,
  WorkerIdSchema,
} from "../src/index.js"
import { FakeClock, instanceId } from "./test-support.js"

describe("EventLedger", () => {
  it("retains only the configured tail with monotonic cursors", () => {
    // Given
    const clock = new FakeClock()
    const ledger = new EventLedger({ capacity: 3, clock })
    const workerId = WorkerIdSchema.parse("worker-00")
    const observedInstanceId = instanceId(1)

    // When
    for (let sequence = 0; sequence < 5; sequence += 1) {
      ledger.append({
        type: GatewayEventType.WORKER_OBSERVED,
        workerId,
        instanceId: observedInstanceId,
      })
      clock.advance(1)
    }

    // Then
    expect(ledger.readAfter().map(({ cursor }) => cursor)).toEqual([3, 4, 5])
    expect(ledger.readAfter(3).map(({ cursor }) => cursor)).toEqual([4, 5])
  })
})
