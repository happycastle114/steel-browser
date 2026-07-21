import { afterEach, describe, expect, it } from "vitest"
import {
  AllocationIdSchema,
  EventLedger,
  GatewayEventType,
  ReconcileOutcome,
  WorkerHttpAdapter,
  WorkerProtocolError,
  WorkerReconciler,
  WorkerRegistry,
  WorkerState,
  WorkerTransportReason,
} from "../src/index.js"
import { LocalWorkerFake, localWorkerProvider } from "./http-worker-fake.js"
import { FakeClock, instanceId, publicSessionId, upstreamSessionId } from "./test-support.js"

const openWorkers: LocalWorkerFake[] = []

afterEach(async () => {
  await Promise.all(openWorkers.splice(0).map(async (worker) => worker.close()))
})

describe("WorkerReconciler HTTP integration", () => {
  it("isolates a non-v4 active session response and continues with its healthy sibling", async () => {
    const first = new LocalWorkerFake({ workerSequence: 0, instanceSequence: 1 })
    const second = new LocalWorkerFake({ workerSequence: 1, instanceSequence: 1 })
    openWorkers.push(first, second)
    const provider = await localWorkerProvider(first, second)
    const clock = new FakeClock()
    const registry = new WorkerRegistry({ clock, ledger: new EventLedger({ clock }) })
    const adapter = new WorkerHttpAdapter({ timeoutMilliseconds: 1_000, maxResponseBytes: 8_192 })
    const reconciler = new WorkerReconciler({ provider, client: adapter, registry })
    const signal = new AbortController().signal
    await reconciler.run(signal)
    first.reportActiveCreateSessionId("550e8400-e29b-11d4-a716-446655440000")

    const endpoint = provider.list().at(0)
    if (endpoint === undefined) throw new TypeError("expected the first configured worker")
    const directProbe = adapter.probe(endpoint, signal)
    await expect(directProbe).rejects.toBeInstanceOf(WorkerProtocolError)
    const report = await reconciler.run(signal)

    expect(report.map(({ outcome }) => outcome)).toEqual([
      ReconcileOutcome.UNREACHABLE,
      ReconcileOutcome.COMMITTED,
    ])
    expect(registry.workers().map(({ state }) => state)).toEqual([
      WorkerState.UNREACHABLE,
      WorkerState.IDLE,
    ])
    await adapter.close()
  })

  it("does not mutate a live session when caller cancellation aborts reconciliation", async () => {
    const first = new LocalWorkerFake({ workerSequence: 0, instanceSequence: 1 })
    const second = new LocalWorkerFake({ workerSequence: 1, instanceSequence: 1 })
    openWorkers.push(first, second)
    const provider = await localWorkerProvider(first, second)
    const clock = new FakeClock()
    const ledger = new EventLedger({ clock })
    const registry = new WorkerRegistry({ clock, ledger })
    const adapter = new WorkerHttpAdapter({ timeoutMilliseconds: 1_000, maxResponseBytes: 8_192 })
    const reconciler = new WorkerReconciler({ provider, client: adapter, registry })
    await reconciler.run(new AbortController().signal)
    const allocationId = AllocationIdSchema.parse("allocation-1")
    registry.reserveNext(allocationId)
    registry.bindSession({
      allocationId,
      publicSessionId: publicSessionId(1),
      upstreamSessionId: upstreamSessionId(1),
    })
    const before = registry.snapshot()
    const eventCount = ledger.readAfter().length
    const cancelled = new AbortController()
    cancelled.abort()

    await expect(reconciler.run(cancelled.signal)).rejects.toMatchObject({
      reason: WorkerTransportReason.ABORTED,
    })

    expect(registry.snapshot()).toEqual(before)
    expect(ledger.readAfter()).toHaveLength(eventCount)
    await adapter.close()
  })

  it("retires the old generation when a static endpoint restarts in place", async () => {
    const first = new LocalWorkerFake({ workerSequence: 0, instanceSequence: 1 })
    const second = new LocalWorkerFake({ workerSequence: 1, instanceSequence: 1 })
    openWorkers.push(first, second)
    const provider = await localWorkerProvider(first, second)
    const clock = new FakeClock()
    const ledger = new EventLedger({ clock })
    const registry = new WorkerRegistry({ clock, ledger })
    const adapter = new WorkerHttpAdapter({ timeoutMilliseconds: 1_000, maxResponseBytes: 8_192 })
    const reconciler = new WorkerReconciler({ provider, client: adapter, registry })

    await reconciler.run(new AbortController().signal)
    first.restart(2)
    await reconciler.run(new AbortController().signal)

    const replacement = registry.workers().find(({ workerId }) => workerId === first.workerId)
    expect(replacement?.instanceId).toBe(instanceId(2))
    expect(ledger.readAfter().some(({ type }) => type === GatewayEventType.WORKER_REPLACED)).toBe(true)
    await adapter.close()
  })
})
