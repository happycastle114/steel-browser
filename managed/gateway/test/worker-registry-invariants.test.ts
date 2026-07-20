import { describe, expect, it } from "vitest"
import {
  AllocationIdSchema,
  DuplicateAllocationIdError,
  DuplicatePublicSessionIdError,
  EventLedger,
  WorkerIdSchema,
  WorkerRegistry,
  WorkerRegistryTransitionError,
  WorkerRemoteState,
  WorkerState,
  type WorkerStateValue,
} from "../src/index.js"
import {
  FakeClock,
  publicSessionId,
  upstreamSessionId,
  workerDescriptor,
} from "./test-support.js"

describe("WorkerRegistry ownership invariants", () => {
  it("rejects a duplicate allocation before mutating an idle sibling", () => {
    const { ledger, registry } = registryWithIdleWorkers()
    const allocationId = AllocationIdSchema.parse("allocation-1")
    registry.reserveNext(allocationId)
    const before = registry.snapshot()
    const eventCount = ledger.readAfter().length

    expect(() => registry.reserveNext(allocationId)).toThrow(DuplicateAllocationIdError)

    expect(registry.snapshot()).toEqual(before)
    expect(ledger.readAfter()).toHaveLength(eventCount)
  })

  it("rejects a duplicate public session before overwriting its owner", () => {
    const { ledger, registry } = registryWithIdleWorkers()
    const sessionId = publicSessionId(1)
    const firstAllocation = AllocationIdSchema.parse("allocation-1")
    registry.reserveNext(firstAllocation)
    registry.bindSession({
      allocationId: firstAllocation,
      publicSessionId: sessionId,
      upstreamSessionId: upstreamSessionId(1),
    })
    const secondAllocation = AllocationIdSchema.parse("allocation-2")
    registry.reserveNext(secondAllocation)
    const before = registry.snapshot()
    const eventCount = ledger.readAfter().length

    expect(() =>
      registry.bindSession({
        allocationId: secondAllocation,
        publicSessionId: sessionId,
        upstreamSessionId: upstreamSessionId(2),
      }),
    ).toThrow(DuplicatePublicSessionIdError)

    expect(registry.snapshot()).toEqual(before)
    expect(ledger.readAfter()).toHaveLength(eventCount)
  })

  it.each([
    WorkerState.LIVE,
    WorkerState.RELEASING,
    WorkerState.RELEASE_UNCERTAIN,
  ] as const)("rejects reservation quarantine from %s without mutation", (targetState) => {
    const { allocationId, ledger, registry } = registryInState(targetState)
    const before = registry.snapshot()
    const eventCount = ledger.readAfter().length

    expect(() => registry.quarantineReservation(allocationId)).toThrow(
      WorkerRegistryTransitionError,
    )

    expect(registry.snapshot()).toEqual(before)
    expect(ledger.readAfter()).toHaveLength(eventCount)
  })
})

function registryWithIdleWorkers() {
  const clock = new FakeClock()
  const ledger = new EventLedger({ clock })
  const registry = new WorkerRegistry({ clock, ledger })
  for (const sequence of [0, 1] as const) {
    const workerId = WorkerIdSchema.parse(`worker-0${sequence}`)
    registry.commitObservation(registry.beginObservation(workerId), {
      worker: workerDescriptor(sequence, 1),
      remoteState: WorkerRemoteState.IDLE,
      sessions: [],
    })
  }
  return { ledger, registry }
}

function registryInState(targetState: WorkerStateValue) {
  const { ledger, registry } = registryWithIdleWorkers()
  const allocationId = AllocationIdSchema.parse("allocation-1")
  const sessionId = publicSessionId(1)
  registry.reserveNext(allocationId)
  registry.bindSession({
    allocationId,
    publicSessionId: sessionId,
    upstreamSessionId: upstreamSessionId(1),
  })
  switch (targetState) {
    case WorkerState.LIVE:
      break
    case WorkerState.RELEASING:
      registry.beginRelease(sessionId)
      break
    case WorkerState.RELEASE_UNCERTAIN:
      registry.beginRelease(sessionId)
      registry.markReleaseUncertain(sessionId)
      break
    default:
      throw new TypeError(`unsupported test state ${targetState}`)
  }
  return { allocationId, ledger, registry }
}
