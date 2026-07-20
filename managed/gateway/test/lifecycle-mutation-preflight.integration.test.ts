import { afterEach, describe, expect, it } from "vitest"
import {
  AdmissionQueue,
  EventLedger,
  LifecycleCreateKind,
  SessionLifecycleCoordinator,
  SessionState,
  WorkerHttpAdapter,
  WorkerMutationNotStartedError,
  WorkerReconciler,
  WorkerRegistry,
  WorkerState,
  type PendingSessionCreate,
} from "../src/index.js"
import { LocalWorkerFake, localWorkerProvider } from "./http-worker-fake.js"
import { FakeClock, SequentialIdGenerator } from "./test-support.js"

const openWorkers: LocalWorkerFake[] = []

afterEach(async () => {
  await Promise.all(openWorkers.splice(0).map(async (worker) => worker.close()))
})

describe("lifecycle mutation preflight cancellation", () => {
  it("returns a reservation to idle when abort wins the real create metadata preflight", async () => {
    const fixture = await lifecycleFixture()
    const cancellation = gatedCancellation(fixture.worker)

    const create = fixture.coordinator.create(cancellation.controller.signal)
    await cancellation.started
    cancellation.controller.abort()
    await Promise.resolve()
    cancellation.openGate()

    await expect(create).rejects.toBeInstanceOf(WorkerMutationNotStartedError)
    expect(fixture.worker.createRequestCount).toBe(0)
    expect(fixture.registry.workers()[0]?.state).toBe(WorkerState.IDLE)
    const current = fixture.registry.workers()[0]
    if (current === undefined) throw new TypeError("expected the first registered worker")
    const listed = await fixture.adapter.list(current, new AbortController().signal)
    expect(listed.sessions).toEqual([])
    await fixture.adapter.close()
  })

  it("restores live state when abort wins the real release metadata preflight", async () => {
    const fixture = await lifecycleFixture()
    const created = await fixture.coordinator.create(new AbortController().signal)
    if (created.kind !== LifecycleCreateKind.CREATED) {
      throw new TypeError("expected an immediately-created session")
    }
    const cancellation = gatedCancellation(fixture.worker)

    const release = fixture.coordinator.release(
      created.session.publicSessionId,
      cancellation.controller.signal,
    )
    await cancellation.started
    cancellation.controller.abort()
    await Promise.resolve()
    cancellation.openGate()

    await expect(release).rejects.toBeInstanceOf(WorkerMutationNotStartedError)
    expect(fixture.worker.releaseRequestCount).toBe(0)
    expect(fixture.registry.session(created.session.publicSessionId)?.state).toBe(SessionState.LIVE)
    expect(fixture.registry.workers()[0]?.state).toBe(WorkerState.LIVE)
    const current = fixture.registry.workers()[0]
    if (current === undefined) throw new TypeError("expected the first registered worker")
    const listed = await fixture.adapter.list(current, new AbortController().signal)
    expect(listed.sessions.map(({ publicSessionId }) => publicSessionId)).toEqual([
      created.session.publicSessionId,
    ])
    await fixture.adapter.close()
  })
})

async function lifecycleFixture() {
  const first = new LocalWorkerFake({ workerSequence: 0, instanceSequence: 1 })
  const second = new LocalWorkerFake({ workerSequence: 1, instanceSequence: 1 })
  openWorkers.push(first, second)
  const provider = await localWorkerProvider(first, second)
  const clock = new FakeClock()
  const ids = new SequentialIdGenerator()
  const registry = new WorkerRegistry({ clock, ledger: new EventLedger({ clock }) })
  const admissions = new AdmissionQueue<PendingSessionCreate>({
    capacity: 2,
    clock,
    ids,
    ticketTtlMilliseconds: 120_000,
  })
  const adapter = new WorkerHttpAdapter({ timeoutMilliseconds: 1_000, maxResponseBytes: 8_192 })
  await new WorkerReconciler({ provider, client: adapter, registry }).run(
    new AbortController().signal,
  )
  const coordinator = new SessionLifecycleCoordinator({ registry, admissions, client: adapter, ids })
  return { adapter, coordinator, registry, worker: first }
}

function gatedCancellation(worker: LocalWorkerFake) {
  let openGate: () => void = () => {}
  let signalStarted: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    openGate = resolve
  })
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve
  })
  worker.gateMetadata(gate, signalStarted)
  return { controller: new AbortController(), openGate, started }
}
