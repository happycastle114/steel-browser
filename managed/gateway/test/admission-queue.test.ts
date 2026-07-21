import { describe, expect, it } from "vitest"
import {
  AdmissionBackpressureError,
  AdmissionConfigurationError,
  AdmissionQueue,
  AdmissionState,
  AllocationIdSchema,
} from "../src/index.js"
import { FakeClock, SequentialIdGenerator } from "./test-support.js"

const SettlementOrder = {
  ABORT_FIRST: "ABORT_FIRST",
  CANCEL_FIRST: "CANCEL_FIRST",
} as const

describe("AdmissionQueue", () => {
  it("hands reservations off in FIFO order while skipping a cancelled middle ticket", () => {
    // Given
    const clock = new FakeClock()
    const queue = new AdmissionQueue<string>({
      capacity: 3,
      clock,
      ids: new SequentialIdGenerator(),
      ticketTtlMilliseconds: 120_000,
    })
    const b = queue.enqueue("B")
    const c = queue.enqueue("C")
    const d = queue.enqueue("D")
    queue.cancel(c.id)

    // When
    const first = queue.reserveNext(AllocationIdSchema.parse("allocation-1"))
    const second = queue.reserveNext(AllocationIdSchema.parse("allocation-2"))

    // Then
    expect(first?.payload).toBe("B")
    expect(second?.payload).toBe("D")
    expect(queue.get(b.id)?.state).toBe(AdmissionState.RESERVED)
    expect(queue.get(c.id)?.state).toBe(AdmissionState.CANCELLED)
    expect(queue.get(d.id)?.state).toBe(AdmissionState.RESERVED)
  })

  it("exposes backpressure before accepting beyond the bounded queue", () => {
    // Given
    const queue = new AdmissionQueue<string>({
      capacity: 1,
      clock: new FakeClock(),
      ids: new SequentialIdGenerator(),
      ticketTtlMilliseconds: 120_000,
    })
    queue.enqueue("B")

    // When
    const enqueueOverflow = () => queue.enqueue("C")

    // Then
    expect(enqueueOverflow).toThrow(AdmissionBackpressureError)
  })

  it.each([
    { name: "abort-first", settle: SettlementOrder.ABORT_FIRST },
    { name: "cancel-first", settle: SettlementOrder.CANCEL_FIRST },
  ] as const)("settles the $name ordering exactly once", ({ settle }) => {
    const clock = new FakeClock()
    const queue = new AdmissionQueue<number>({
      capacity: 1,
      clock,
      ids: new SequentialIdGenerator(),
      ticketTtlMilliseconds: 120_000,
    })
    const controller = new AbortController()
    const ticket = queue.enqueue(1, controller.signal)

    if (settle === SettlementOrder.ABORT_FIRST) {
      controller.abort()
      queue.cancel(ticket.id)
    } else {
      queue.cancel(ticket.id)
      controller.abort()
    }

    expect(queue.activeCount()).toBe(0)
    expect(queue.terminalCount()).toBe(1)
    expect(queue.get(ticket.id)?.state).toBe(AdmissionState.CANCELLED)
  })

  it.each([-1, 0, Number.POSITIVE_INFINITY, Number.NaN])(
    "rejects an unbounded retained terminal capacity of %s",
    (retainedTerminalCapacity) => {
      // Given / When
      const createQueue = () =>
        new AdmissionQueue<string>({
          capacity: 1,
          clock: new FakeClock(),
          ids: new SequentialIdGenerator(),
          retainedTerminalCapacity,
          ticketTtlMilliseconds: 120_000,
        })

      // Then
      expect(createQueue).toThrow(AdmissionConfigurationError)
    },
  )

  it("expires a reserved ticket once and returns its allocation for cleanup", () => {
    // Given
    const clock = new FakeClock()
    const queue = new AdmissionQueue<string>({
      capacity: 1,
      clock,
      ids: new SequentialIdGenerator(),
      ticketTtlMilliseconds: 10,
    })
    const ticket = queue.enqueue("B")
    const allocationId = AllocationIdSchema.parse("allocation-1")
    queue.reserveNext(allocationId)
    clock.advance(10)

    // When
    const first = queue.expireDue()
    const second = queue.expireDue()

    // Then
    expect(first).toEqual([
      {
        ticket: queue.get(ticket.id),
        releasedAllocationId: allocationId,
      },
    ])
    expect(second).toEqual([])
    expect(queue.get(ticket.id)?.state).toBe(AdmissionState.EXPIRED)
    expect(queue.activeCount()).toBe(0)
  })

  it("evicts only the oldest terminal record at the configured retention boundary", () => {
    const queue = new AdmissionQueue<string>({
      capacity: 2,
      clock: new FakeClock(),
      ids: new SequentialIdGenerator(),
      retainedTerminalCapacity: 1,
      ticketTtlMilliseconds: 120_000,
    })
    const first = queue.enqueue("first")
    const second = queue.enqueue("second")

    queue.cancel(first.id)
    queue.cancel(second.id)

    expect(queue.get(first.id)).toBeUndefined()
    expect(queue.get(second.id)?.state).toBe(AdmissionState.CANCELLED)
    expect(queue.terminalCount()).toBe(1)
  })
})
