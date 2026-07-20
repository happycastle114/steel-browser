import { afterEach, describe, expect, it } from "vitest"
import {
  StaticWorkerEndpointSchema,
  WorkerHttpAdapter,
  WorkerHttpStatusError,
  WorkerIdentityMismatchError,
  WorkerProtocolError,
} from "../src/index.js"
import { LocalWorkerFake } from "./http-worker-fake.js"
import { publicSessionId } from "./test-support.js"

const openWorkers: LocalWorkerFake[] = []

afterEach(async () => {
  await Promise.all(openWorkers.splice(0).map(async (worker) => worker.close()))
})

describe("WorkerHttpAdapter identity integration", () => {
  it("rejects a post-response mutation after same-endpoint restart", async () => {
    let responseObserved = false
    let restartAfterResponse: (() => void) | undefined
    const fake = new LocalWorkerFake({
      workerSequence: 0,
      instanceSequence: 1,
      onCreateResponse: () => {
        responseObserved = true
        restartAfterResponse?.()
      },
    })
    openWorkers.push(fake)
    restartAfterResponse = () => fake.restart(2)
    const endpoint = StaticWorkerEndpointSchema.parse({
      workerId: fake.workerId,
      origin: await fake.listen(),
    })
    const adapter = new WorkerHttpAdapter({ timeoutMilliseconds: 1_000, maxResponseBytes: 8_192 })
    const probe = await adapter.probe(endpoint, new AbortController().signal)

    const create = adapter.create(
      probe.worker,
      { publicSessionId: publicSessionId(1) },
      new AbortController().signal,
    )

    await expect(create).rejects.toBeInstanceOf(WorkerIdentityMismatchError)
    expect(responseObserved).toBe(true)
    expect(fake.createRequestCount).toBe(1)
    await adapter.close()
  })

  it("rejects metadata that reports a different configured worker id", async () => {
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

    await expect(adapter.probe(endpoint, new AbortController().signal)).rejects.toBeInstanceOf(
      WorkerIdentityMismatchError,
    )
    await adapter.close()
  })

  it.each([
    { name: "body instance id", options: { reportedInstanceSequence: 2 } },
    { name: "header worker id", options: { headerWorkerSequence: 1 } },
    { name: "header instance id", options: { headerInstanceSequence: 2 } },
  ])("rejects an independent $name mismatch", async ({ options }) => {
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

    await expect(adapter.probe(endpoint, new AbortController().signal)).rejects.toBeInstanceOf(
      WorkerIdentityMismatchError,
    )
    await adapter.close()
  })

  it.each([
    { name: "worker", options: { omitWorkerHeader: true } },
    { name: "instance", options: { omitInstanceHeader: true } },
  ])("rejects metadata with a missing $name identity header", async ({ options }) => {
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

    await expect(adapter.probe(endpoint, new AbortController().signal)).rejects.toThrow(
      "worker response instance header missing",
    )
    await adapter.close()
  })

  it("keeps a bounded HTTP 503 typed after validating metadata identity", async () => {
    const fake = new LocalWorkerFake({
      workerSequence: 0,
      instanceSequence: 1,
      metadataStatus: 503,
    })
    openWorkers.push(fake)
    const endpoint = StaticWorkerEndpointSchema.parse({
      workerId: fake.workerId,
      origin: await fake.listen(),
    })
    const adapter = new WorkerHttpAdapter({ timeoutMilliseconds: 1_000, maxResponseBytes: 8_192 })

    await expect(adapter.probe(endpoint, new AbortController().signal)).rejects.toBeInstanceOf(
      WorkerHttpStatusError,
    )
    await adapter.close()
  })

  it("rejects malformed metadata even when the worker reports 503", async () => {
    const fake = new LocalWorkerFake({
      workerSequence: 0,
      instanceSequence: 1,
      metadataStatus: 503,
      malformedMetadata: true,
    })
    openWorkers.push(fake)
    const endpoint = StaticWorkerEndpointSchema.parse({
      workerId: fake.workerId,
      origin: await fake.listen(),
    })
    const adapter = new WorkerHttpAdapter({ timeoutMilliseconds: 1_000, maxResponseBytes: 8_192 })

    await expect(adapter.probe(endpoint, new AbortController().signal)).rejects.toBeInstanceOf(
      WorkerProtocolError,
    )
    await adapter.close()
  })
})
