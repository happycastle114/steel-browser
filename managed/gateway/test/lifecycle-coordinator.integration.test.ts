import { afterEach, describe, expect, it } from "vitest"
import {
  AdmissionQueue,
  EventLedger,
  LifecycleCreateKind,
  LifecycleCreateCancelledError,
  SessionLifecycleCoordinator,
  SessionState,
  AdmissionState,
  WorkerHttpAdapter,
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

describe("SessionLifecycleCoordinator integration", () => {
  it("runs two isolated sessions, queues a third, and hands capacity off after reconciled release", async () => {
    // Given
    const first = new LocalWorkerFake({ workerSequence: 0, instanceSequence: 1 })
    const second = new LocalWorkerFake({ workerSequence: 1, instanceSequence: 1 })
    openWorkers.push(first, second)
    const provider = await localWorkerProvider(first, second)
    const clock = new FakeClock()
    const ids = new SequentialIdGenerator()
    const registry = new WorkerRegistry({ clock, ledger: new EventLedger({ clock }) })
    const admissions = new AdmissionQueue<PendingSessionCreate>({
      capacity: 4,
      clock,
      ids,
      ticketTtlMilliseconds: 120_000,
    })
    const adapter = new WorkerHttpAdapter({ timeoutMilliseconds: 1_000, maxResponseBytes: 8_192 })
    const reconciler = new WorkerReconciler({ provider, client: adapter, registry })
    const coordinator = new SessionLifecycleCoordinator({ registry, admissions, client: adapter, ids })
    const signal = new AbortController().signal
    await reconciler.run(signal)

    // When
    const createdOne = await coordinator.create(signal)
    const createdTwo = await coordinator.create(signal)
    const queued = await coordinator.create(signal)
    expect(createdOne.kind).toBe(LifecycleCreateKind.CREATED)
    if (createdOne.kind !== LifecycleCreateKind.CREATED) {
      throw new TypeError("expected the first lifecycle result to be created")
    }
    await coordinator.release(createdOne.session.publicSessionId, signal)
    const admitted = await coordinator.processNext(signal)

    // Then
    expect(createdTwo.kind).toBe(LifecycleCreateKind.CREATED)
    expect(queued.kind).toBe(LifecycleCreateKind.QUEUED)
    expect(admitted?.kind).toBe(LifecycleCreateKind.CREATED)
    expect(registry.session(createdOne.session.publicSessionId)?.state).toBe(SessionState.RELEASED)
    expect(registry.workers().filter(({ state }) => state === WorkerState.LIVE)).toHaveLength(2)
    await adapter.close()
  })

  it("quarantines a reservation after a typed worker create failure without consuming its sibling", async () => {
    // Given
    const failing = new LocalWorkerFake({
      workerSequence: 0,
      instanceSequence: 1,
      createStatus: 503,
    })
    const sibling = new LocalWorkerFake({ workerSequence: 1, instanceSequence: 1 })
    openWorkers.push(failing, sibling)
    const provider = await localWorkerProvider(failing, sibling)
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

    // When
    const create = coordinator.create(new AbortController().signal)

    // Then
    await expect(create).rejects.toMatchObject({ statusCode: 503 })
    expect(registry.workers().map(({ state }) => state)).toEqual([
      WorkerState.QUARANTINED,
      WorkerState.IDLE,
    ])
    await adapter.close()
  })

  it("releases a worker-created session when its queued admission abort wins the response race", async () => {
    // Given
    let openResponseGate: (() => void) | undefined
    let signalCreated: (() => void) | undefined
    const responseGate = new Promise<void>((resolve) => {
      openResponseGate = resolve
    })
    const created = new Promise<void>((resolve) => {
      signalCreated = resolve
    })
    const first = new LocalWorkerFake({
      workerSequence: 0,
      instanceSequence: 1,
      gatedCreateSequence: 2,
      createResponseGate: responseGate,
      onGatedCreate: () => signalCreated?.(),
    })
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
    const coordinator = new SessionLifecycleCoordinator({ registry, admissions, client: adapter, ids })
    const signal = new AbortController().signal
    await new WorkerReconciler({ provider, client: adapter, registry }).run(signal)
    const firstCreated = await coordinator.create(signal)
    await coordinator.create(signal)
    const queuedAbort = new AbortController()
    const queued = await coordinator.create(queuedAbort.signal)
    if (
      firstCreated.kind !== LifecycleCreateKind.CREATED ||
      queued.kind !== LifecycleCreateKind.QUEUED
    ) {
      throw new TypeError("expected created and queued lifecycle results")
    }
    await coordinator.release(firstCreated.session.publicSessionId, signal)

    // When
    const handoff = coordinator.processNext(signal)
    await created
    queuedAbort.abort()
    openResponseGate?.()

    // Then
    await expect(handoff).rejects.toBeInstanceOf(LifecycleCreateCancelledError)
    expect(admissions.get(queued.admissionTicketId)?.state).toBe(AdmissionState.CANCELLED)
    expect(registry.liveSessionIds()).toHaveLength(1)
    expect(registry.workers().map(({ state }) => state)).toEqual([
      WorkerState.IDLE,
      WorkerState.LIVE,
    ])
    await adapter.close()
  })

})
