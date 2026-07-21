import { afterEach, describe, expect, it } from "vitest"
import {
  AdmissionQueue,
  EventLedger,
  LifecycleCreateKind,
  SessionLifecycleCoordinator,
  SessionState,
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

describe("uncertain release recovery", () => {
  it("finalizes release when the same worker is observed idle", async () => {
    const fixture = await uncertainReleaseFixture(true)

    await expect(fixture.release()).rejects.toMatchObject({ statusCode: 503 })
    expect(fixture.registry.session(fixture.sessionId)?.state).toBe(SessionState.RELEASING)
    expect(fixture.registry.workers()[0]?.state).toBe(WorkerState.RELEASE_UNCERTAIN)
    await fixture.reconciler.run(fixture.signal)

    expect(fixture.registry.session(fixture.sessionId)?.state).toBe(SessionState.RELEASED)
    expect(fixture.registry.workers()[0]?.state).toBe(WorkerState.IDLE)
    await fixture.adapter.close()
  })

  it("restores the session when the same worker is observed busy", async () => {
    const fixture = await uncertainReleaseFixture(false)

    await expect(fixture.release()).rejects.toMatchObject({ statusCode: 503 })
    await fixture.reconciler.run(fixture.signal)

    expect(fixture.registry.session(fixture.sessionId)?.state).toBe(SessionState.LIVE)
    expect(fixture.registry.workers()[0]?.state).toBe(WorkerState.LIVE)
    expect(fixture.registry.liveSessionIds()).toEqual([fixture.sessionId])
    await fixture.adapter.close()
  })

  it("preserves release linkage through a failed probe before idle confirmation", async () => {
    const fixture = await uncertainReleaseFixture(true)
    await expect(fixture.release()).rejects.toMatchObject({ statusCode: 503 })
    fixture.worker.setActiveCreatesStatus(503)

    await fixture.reconciler.run(fixture.signal)

    expect(fixture.registry.session(fixture.sessionId)?.state).toBe(SessionState.RELEASING)
    expect(fixture.registry.workers()[0]?.state).toBe(
      WorkerState.RELEASE_UNCERTAIN_UNREACHABLE,
    )
    fixture.worker.setActiveCreatesStatus(200)
    await fixture.reconciler.run(fixture.signal)
    expect(fixture.registry.session(fixture.sessionId)?.state).toBe(SessionState.RELEASED)
    expect(fixture.registry.workers()[0]?.state).toBe(WorkerState.IDLE)
    await fixture.adapter.close()
  })
})

async function uncertainReleaseFixture(releaseApplies: boolean) {
  const first = new LocalWorkerFake({
    workerSequence: 0,
    instanceSequence: 1,
    releaseStatus: 503,
    releaseApplies,
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
  const reconciler = new WorkerReconciler({ provider, client: adapter, registry })
  const signal = new AbortController().signal
  await reconciler.run(signal)
  const coordinator = new SessionLifecycleCoordinator({ registry, admissions, client: adapter, ids })
  const created = await coordinator.create(signal)
  if (created.kind !== LifecycleCreateKind.CREATED) {
    throw new TypeError("expected an immediately-created lifecycle result")
  }
  const sessionId = created.session.publicSessionId
  return {
    adapter,
    reconciler,
    registry,
    sessionId,
    signal,
    worker: first,
    release: async () => coordinator.release(sessionId, signal),
  }
}
