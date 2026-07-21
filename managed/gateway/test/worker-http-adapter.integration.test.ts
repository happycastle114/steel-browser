import { afterEach, describe, expect, it } from "vitest"
import {
  CREATE_JOURNAL_STATE,
  MANAGED_CREATE_HEADER,
  ManagedCreateHeaderValuesSchema,
  PRIVATE_SUPERVISOR_BODY_LIMIT,
} from "@happycastle/steel-managed-shared"
import {
  StaticWorkerEndpointSchema,
  WorkerHttpAdapter,
  WorkerHttpStatusError,
  WorkerIdentityMismatchError,
  WorkerProtocolError,
  WorkerRemoteState,
  WorkerTransportError,
  WorkerTransportReason,
} from "../src/index.js"
import { LocalWorkerFake } from "./http-worker-fake.js"
import { publicSessionId } from "./test-support.js"

const openWorkers: LocalWorkerFake[] = []

afterEach(async () => {
  await Promise.all(openWorkers.splice(0).map(async (worker) => worker.close()))
})

describe("WorkerHttpAdapter integration", () => {
  it("probes, creates, lists, and releases against a real local Fastify worker", async () => {
    // Given
    const fake = new LocalWorkerFake({ workerSequence: 0, instanceSequence: 1 })
    openWorkers.push(fake)
    const origin = await fake.listen()
    const endpoint = StaticWorkerEndpointSchema.parse({ workerId: fake.workerId, origin })
    const adapter = new WorkerHttpAdapter({ timeoutMilliseconds: 1_000, maxResponseBytes: 8_192 })
    const signal = new AbortController().signal

    // When
    const probe = await adapter.probe(endpoint, signal)
    const created = await adapter.create(
      probe.worker,
      {
        publicSessionId: publicSessionId(1),
      },
      signal,
    )
    const listed = await adapter.list(probe.worker, signal)
    await adapter.release(probe.worker, created.upstreamSessionId, signal)
    const releasedList = await adapter.list(probe.worker, signal)
    await adapter.close()

    // Then
    expect(probe.remoteState).toBe(WorkerRemoteState.IDLE)
    expect(listed.sessions).toHaveLength(1)
    expect(releasedList.sessions).toHaveLength(0)
  })

  it("forwards the exact validated managed create journal headers", async () => {
    const fake = new LocalWorkerFake({ workerSequence: 0, instanceSequence: 1 })
    openWorkers.push(fake)
    const endpoint = StaticWorkerEndpointSchema.parse({
      workerId: fake.workerId,
      origin: await fake.listen(),
    })
    const adapter = new WorkerHttpAdapter({ timeoutMilliseconds: 1_000, maxResponseBytes: 8_192 })
    const signal = new AbortController().signal
    const probe = await adapter.probe(endpoint, signal)
    const managedCreate = ManagedCreateHeaderValuesSchema.parse({
      [MANAGED_CREATE_HEADER.MANAGER_INSTANCE_ID]: "00000000-0000-4000-8000-000000000301",
      [MANAGED_CREATE_HEADER.OWNER_SHA256]: "a".repeat(64),
      [MANAGED_CREATE_HEADER.POOL_ID]: "test-pool",
      [MANAGED_CREATE_HEADER.REQUEST_SHA256]: "b".repeat(64),
      [MANAGED_CREATE_HEADER.TOKEN]: `h1_${"c".repeat(64)}`,
    })

    await adapter.create(probe.worker, {
      managedCreate,
      publicSessionId: publicSessionId(1),
    }, signal)

    expect(fake.managedCreateHeaders).toEqual(managedCreate)
    await adapter.close()
  })

  it("rejects a raw call when the worker generation changed after discovery", async () => {
    // Given
    const fake = new LocalWorkerFake({ workerSequence: 0, instanceSequence: 1 })
    openWorkers.push(fake)
    const endpoint = StaticWorkerEndpointSchema.parse({
      workerId: fake.workerId,
      origin: await fake.listen(),
    })
    const adapter = new WorkerHttpAdapter({ timeoutMilliseconds: 1_000, maxResponseBytes: 8_192 })

    // When
    const probe = await adapter.probe(endpoint, new AbortController().signal)
    fake.restart(2)
    const list = adapter.list(probe.worker, new AbortController().signal)

    // Then
    await expect(list).rejects.toBeInstanceOf(WorkerIdentityMismatchError)
    await adapter.close()
  })

  it("rejects a probe when restart wins between metadata and the raw list response", async () => {
    // Given
    let openListGate: (() => void) | undefined
    let signalListStarted: (() => void) | undefined
    const listGate = new Promise<void>((resolve) => {
      openListGate = resolve
    })
    const listStarted = new Promise<void>((resolve) => {
      signalListStarted = resolve
    })
    const fake = new LocalWorkerFake({
      workerSequence: 0,
      instanceSequence: 1,
      activeCreatesGate: listGate,
      onActiveCreates: () => signalListStarted?.(),
    })
    openWorkers.push(fake)
    const endpoint = StaticWorkerEndpointSchema.parse({
      workerId: fake.workerId,
      origin: await fake.listen(),
    })
    const adapter = new WorkerHttpAdapter({ timeoutMilliseconds: 1_000, maxResponseBytes: 8_192 })

    // When
    const probe = adapter.probe(endpoint, new AbortController().signal)
    await listStarted
    fake.restart(2)
    openListGate?.()

    // Then
    await expect(probe).rejects.toBeInstanceOf(WorkerIdentityMismatchError)
    await adapter.close()
  })

  it("returns a typed status error for a worker 503", async () => {
    // Given
    const fake = new LocalWorkerFake({ workerSequence: 0, instanceSequence: 1, createStatus: 503 })
    openWorkers.push(fake)
    const endpoint = StaticWorkerEndpointSchema.parse({
      workerId: fake.workerId,
      origin: await fake.listen(),
    })
    const adapter = new WorkerHttpAdapter({ timeoutMilliseconds: 1_000, maxResponseBytes: 8_192 })
    const signal = new AbortController().signal
    const probe = await adapter.probe(endpoint, signal)

    // When
    const create = adapter.create(
      probe.worker,
      {
        publicSessionId: publicSessionId(1),
      },
      signal,
    )

    // Then
    await expect(create).rejects.toMatchObject({ statusCode: 503 })
    await expect(create).rejects.toBeInstanceOf(WorkerHttpStatusError)
    await adapter.close()
  })

  it.each([
    CREATE_JOURNAL_STATE.ACCEPTED,
    CREATE_JOURNAL_STATE.UPSTREAM_PENDING,
    CREATE_JOURNAL_STATE.UNCERTAIN,
  ])("keeps an active %s create busy without inventing a live session", async (state) => {
    // Given
    const fake = new LocalWorkerFake({ workerSequence: 0, instanceSequence: 1 })
    openWorkers.push(fake)
    const endpoint = StaticWorkerEndpointSchema.parse({
      workerId: fake.workerId,
      origin: await fake.listen(),
    })
    const adapter = new WorkerHttpAdapter({ timeoutMilliseconds: 1_000, maxResponseBytes: 8_192 })
    fake.reportPendingCreate(state)

    // When
    const probe = await adapter.probe(endpoint, new AbortController().signal)

    // Then
    expect(probe.remoteState).toBe(WorkerRemoteState.BUSY)
    expect(probe.sessions).toEqual([])
    await adapter.close()
  })

  it("fails closed at the canonical active-creates route body limit", async () => {
    // Given
    const fake = new LocalWorkerFake({
      workerSequence: 0,
      instanceSequence: 1,
      activeCreatesPaddingBytes: PRIVATE_SUPERVISOR_BODY_LIMIT.CREATES_ACTIVE + 1_024,
    })
    openWorkers.push(fake)
    const endpoint = StaticWorkerEndpointSchema.parse({
      workerId: fake.workerId,
      origin: await fake.listen(),
    })
    const adapter = new WorkerHttpAdapter({
      timeoutMilliseconds: 1_000,
      maxResponseBytes: 1_048_576,
    })

    // When
    const probe = adapter.probe(endpoint, new AbortController().signal)

    // Then
    await expect(probe).rejects.toThrow("worker response exceeded route body limit")
    await expect(probe).rejects.toBeInstanceOf(WorkerProtocolError)
    await adapter.close()
  })

  it("aborts a real HTTP probe at the configured bounded timeout", async () => {
    // Given
    let openGate: (() => void) | undefined
    const metadataGate = new Promise<void>((resolve) => {
      openGate = resolve
    })
    const fake = new LocalWorkerFake({
      workerSequence: 0,
      instanceSequence: 1,
      metadataGate,
    })
    openWorkers.push(fake)
    const endpoint = StaticWorkerEndpointSchema.parse({
      workerId: fake.workerId,
      origin: await fake.listen(),
    })
    const adapter = new WorkerHttpAdapter({ timeoutMilliseconds: 20, maxResponseBytes: 8_192 })

    // When
    const probe = adapter.probe(endpoint, new AbortController().signal)

    // Then
    await expect(probe).rejects.toMatchObject({ reason: WorkerTransportReason.ABORTED })
    await expect(probe).rejects.toBeInstanceOf(WorkerTransportError)
    openGate?.()
    await adapter.close()
  })
})
