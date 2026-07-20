import { afterEach, describe, expect, it } from "vitest"
import {
  StaticWorkerEndpointSchema,
  WorkerHttpAdapter,
  WorkerHttpStatusError,
  WorkerIdentityMismatchError,
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
      sessionListGate: listGate,
      onSessionList: () => signalListStarted?.(),
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

  it("rejects metadata that reports a different configured worker id", async () => {
    // Given
    const fake = new LocalWorkerFake({
      workerSequence: 0,
      instanceSequence: 1,
      reportedWorkerSequence: 1,
    })
    openWorkers.push(fake)
    const endpoint = StaticWorkerEndpointSchema.parse({
      workerId: fake.workerId,
      origin: await fake.listen(),
    })
    const adapter = new WorkerHttpAdapter({ timeoutMilliseconds: 1_000, maxResponseBytes: 8_192 })

    // When
    const probe = adapter.probe(endpoint, new AbortController().signal)

    // Then
    await expect(probe).rejects.toBeInstanceOf(WorkerIdentityMismatchError)
    await adapter.close()
  })

  it.each([
    {
      name: "body instance id",
      options: { reportedInstanceSequence: 2 },
    },
    {
      name: "header worker id",
      options: { headerWorkerSequence: 1 },
    },
    {
      name: "header instance id",
      options: { headerInstanceSequence: 2 },
    },
  ])("rejects an independent $name mismatch", async ({ options }) => {
    // Given
    const fake = new LocalWorkerFake({
      workerSequence: 0,
      instanceSequence: 1,
      ...options,
    })
    openWorkers.push(fake)
    const endpoint = StaticWorkerEndpointSchema.parse({
      workerId: fake.workerId,
      origin: await fake.listen(),
    })
    const adapter = new WorkerHttpAdapter({ timeoutMilliseconds: 1_000, maxResponseBytes: 8_192 })

    // When
    const probe = adapter.probe(endpoint, new AbortController().signal)

    // Then
    await expect(probe).rejects.toBeInstanceOf(WorkerIdentityMismatchError)
    await adapter.close()
  })

  it("fails closed when the active-session response exceeds the configured body bound", async () => {
    // Given
    const fake = new LocalWorkerFake({
      workerSequence: 0,
      instanceSequence: 1,
      sessionListPaddingBytes: 1_024,
    })
    openWorkers.push(fake)
    const endpoint = StaticWorkerEndpointSchema.parse({
      workerId: fake.workerId,
      origin: await fake.listen(),
    })
    const adapter = new WorkerHttpAdapter({ timeoutMilliseconds: 1_000, maxResponseBytes: 256 })

    // When
    const probe = adapter.probe(endpoint, new AbortController().signal)

    // Then
    await expect(probe).rejects.toMatchObject({ reason: WorkerTransportReason.NETWORK })
    await expect(probe).rejects.toBeInstanceOf(WorkerTransportError)
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
