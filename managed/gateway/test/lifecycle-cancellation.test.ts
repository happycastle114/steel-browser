import { describe, expect, it } from "vitest"
import {
  AdmissionQueue,
  AdmissionState,
  AllocationIdSchema,
  EventLedger,
  LifecycleAbortedError,
  LifecycleOperation,
  SessionLifecycleCoordinator,
  SessionState,
  UpstreamSessionIdSchema,
  WorkerRegistry,
  WorkerRemoteState,
  WorkerState,
  type PendingSessionCreate,
  type WorkerCreateCommand,
  type WorkerCreateResult,
  type WorkerDescriptor,
  type WorkerHttpClient,
  type WorkerListResult,
  type WorkerProbe,
} from "../src/index.js"
import {
  FakeClock,
  SequentialIdGenerator,
  publicSessionId,
  upstreamSessionId,
  workerDescriptor,
} from "./test-support.js"

describe("SessionLifecycleCoordinator cancellation", () => {
  it("rejects an already-aborted create before reserving capacity", async () => {
    const fixture = coordinatorFixture()
    const cancelled = abortedController()

    await expect(fixture.coordinator.create(cancelled.signal)).rejects.toMatchObject({
      operation: LifecycleOperation.CREATE,
    })

    expect(fixture.client.mutationCalls).toBe(0)
    expect(fixture.registry.workers()[0]?.state).toBe(WorkerState.IDLE)
  })

  it("rejects an already-aborted handoff before dequeuing its ticket", async () => {
    const fixture = coordinatorFixture()
    const ticket = fixture.admissions.enqueue({ publicSessionId: publicSessionId(1) })
    const cancelled = abortedController()

    await expect(fixture.coordinator.processNext(cancelled.signal)).rejects.toBeInstanceOf(
      LifecycleAbortedError,
    )

    expect(fixture.client.mutationCalls).toBe(0)
    expect(fixture.admissions.get(ticket.id)?.state).toBe(AdmissionState.QUEUED)
    expect(fixture.registry.workers()[0]?.state).toBe(WorkerState.IDLE)
  })

  it("rejects an already-aborted release before changing a live session", async () => {
    const fixture = boundCoordinatorFixture()
    const cancelled = abortedController()

    await expect(
      fixture.coordinator.release(fixture.sessionId, cancelled.signal),
    ).rejects.toMatchObject({ operation: LifecycleOperation.RELEASE })

    expect(fixture.client.mutationCalls).toBe(0)
    expect(fixture.registry.session(fixture.sessionId)?.state).toBe(SessionState.LIVE)
    expect(fixture.registry.workers()[0]?.state).toBe(WorkerState.LIVE)
  })

})

class StubWorkerClient implements WorkerHttpClient {
  /** Mutable call count verifies entry guards do not reach worker mutations. */
  public mutationCalls = 0

  public async probe(): Promise<WorkerProbe> {
    return {
      worker: workerDescriptor(0, 1),
      remoteState: WorkerRemoteState.IDLE,
      sessions: [],
    }
  }

  public async list(worker: WorkerDescriptor): Promise<WorkerListResult> {
    return { worker, remoteState: WorkerRemoteState.IDLE, sessions: [] }
  }

  public async create(
    worker: WorkerDescriptor,
    command: WorkerCreateCommand,
    signal: AbortSignal,
  ): Promise<WorkerCreateResult> {
    this.mutationCalls += 1
    void signal
    return { worker, upstreamSessionId: UpstreamSessionIdSchema.parse(command.publicSessionId) }
  }

  public async release(
    worker: WorkerDescriptor,
    upstreamSessionId: WorkerCreateResult["upstreamSessionId"],
    signal: AbortSignal,
  ): Promise<void> {
    this.mutationCalls += 1
    void worker
    void upstreamSessionId
    void signal
  }
}

function coordinatorFixture() {
  const clock = new FakeClock()
  const ids = new SequentialIdGenerator()
  const registry = new WorkerRegistry({ clock, ledger: new EventLedger({ clock }) })
  const worker = workerDescriptor(0, 1)
  registry.commitObservation(registry.beginObservation(worker.workerId), {
    worker,
    remoteState: WorkerRemoteState.IDLE,
    sessions: [],
  })
  const admissions = new AdmissionQueue<PendingSessionCreate>({
    capacity: 2,
    clock,
    ids,
    ticketTtlMilliseconds: 120_000,
  })
  const client = new StubWorkerClient()
  const coordinator = new SessionLifecycleCoordinator({ registry, admissions, client, ids })
  return { admissions, client, coordinator, registry }
}

function boundCoordinatorFixture() {
  const fixture = coordinatorFixture()
  const allocationId = AllocationIdSchema.parse("allocation-bound")
  const sessionId = publicSessionId(1)
  fixture.registry.reserveNext(allocationId)
  fixture.registry.bindSession({
    allocationId,
    publicSessionId: sessionId,
    upstreamSessionId: upstreamSessionId(1),
  })
  return { ...fixture, sessionId }
}

function abortedController(): AbortController {
  const controller = new AbortController()
  controller.abort()
  return controller
}
