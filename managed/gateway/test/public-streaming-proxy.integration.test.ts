import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { afterEach, describe, expect, it } from "vitest"
import {
  InstanceIdSchema,
  WorkerIdentityMismatchError,
  WorkerDescriptorSchema,
  WorkerIdSchema,
  type WorkerDescriptor,
} from "../src/index.js"
import { PublicHttpMethod } from "../src/api/public/schemas.js"
import {
  WorkerRestProxy,
  WorkerRestBadResponseError,
  type WorkerGenerationVerifier,
} from "../src/api/public/proxy.js"

const MANAGER_INSTANCE_ID = "11111111-2222-4333-8444-555555555555"
const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }))
})

class CurrentVerifier implements WorkerGenerationVerifier {
  public async assertCurrent(_worker: WorkerDescriptor): Promise<void> {}
}

class FailingVerifier implements WorkerGenerationVerifier {
  private calls = 0

  public async assertCurrent(worker: WorkerDescriptor): Promise<void> {
    this.calls += 1
    if (this.calls === 3) throw new WorkerIdentityMismatchError(worker.workerId, worker.instanceId)
  }
}

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new TypeError("expected TCP address")
  return `http://127.0.0.1:${address.port}`
}

function worker(origin: string): WorkerDescriptor {
  return WorkerDescriptorSchema.parse({
    workerId: WorkerIdSchema.parse("worker-00"),
    instanceId: InstanceIdSchema.parse("00000000-0000-4000-8000-000000000001"),
    origin,
  })
}

function proxy(options: {
  readonly maxResponseBytes?: number
  readonly verifier?: WorkerGenerationVerifier
} = {}): WorkerRestProxy {
  return new WorkerRestProxy({
    identity: { managerInstanceId: MANAGER_INSTANCE_ID, poolId: "blue" },
    maxResponseBytes: options.maxResponseBytes ?? 1024,
    maxRequestBytes: 1024,
    timeoutMilliseconds: 1000,
    verifier: options.verifier ?? new CurrentVerifier(),
  })
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("stream observation timed out")), 500)
      timer.unref()
    }),
  ])
}

describe("WorkerRestProxy streaming integration", () => {
  it("delivers the initial SSE event before the worker closes", async () => {
    // Given
    const origin = await listen((_request, response) => {
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "x-upstream-additive": "preserved",
      })
      response.write(": connected\n\n")
    })
    const transport = proxy()

    // When
    const response = await transport.openStream({
      headers: {},
      method: PublicHttpMethod.GET,
      pathAndQuery: "/v1/logs/stream",
      signal: new AbortController().signal,
      worker: worker(origin),
    })
    const iterator = response.body[Symbol.asyncIterator]()
    const first = await bounded(iterator.next())

    // Then
    expect(response.statusCode).toBe(200)
    expect(response.headers["content-type"]).toContain("text/event-stream")
    expect(response.headers["x-upstream-additive"]).toBe("preserved")
    expect(first.done).toBe(false)
    expect(first.value?.toString("utf8")).toBe(": connected\n\n")
    response.cancel()
    await response.closed
    await transport.close()
  })

  it("aborts the worker request and closes the public stream", async () => {
    // Given
    let disconnected: (() => void) | undefined
    const workerClosed = new Promise<void>((resolve) => {
      disconnected = resolve
    })
    const origin = await listen((request, response) => {
      request.once("close", () => disconnected?.())
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.write("data: first\n\n")
    })
    const abort = new AbortController()
    const transport = proxy()
    const response = await transport.openStream({
      headers: {},
      method: PublicHttpMethod.GET,
      pathAndQuery: "/v1/logs/stream",
      signal: abort.signal,
      worker: worker(origin),
    })
    await bounded(response.body[Symbol.asyncIterator]().next())

    // When
    abort.abort()

    // Then
    await bounded(response.closed)
    await bounded(workerClosed)
    expect(response.body.destroyed).toBe(true)
    await transport.close()
  })

  it("surfaces worker death and releases the stream", async () => {
    // Given
    let terminate: (() => void) | undefined
    const origin = await listen((_request, response) => {
      terminate = () => response.destroy()
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.write("data: first\n\n")
    })
    const transport = proxy()
    const response = await transport.openStream({
      headers: {},
      method: PublicHttpMethod.GET,
      pathAndQuery: "/v1/logs/stream",
      signal: new AbortController().signal,
      worker: worker(origin),
    })
    const iterator = response.body[Symbol.asyncIterator]()
    await bounded(iterator.next())

    // When
    terminate?.()

    // Then
    await expect(bounded(iterator.next())).rejects.toBeInstanceOf(WorkerRestBadResponseError)
    await bounded(response.closed)
    await transport.close()
  })

  it("bounds unread stream data and cleans up a slow consumer", async () => {
    // Given
    let interval: ReturnType<typeof setInterval> | undefined
    const origin = await listen((request, response) => {
      request.once("close", () => clearInterval(interval))
      response.writeHead(200, { "content-type": "text/event-stream" })
      interval = setInterval(() => response.write(Buffer.alloc(128, 65)), 2)
    })
    const transport = proxy({ maxResponseBytes: 1024 })
    const response = await transport.openStream({
      headers: {},
      method: PublicHttpMethod.GET,
      pathAndQuery: "/v1/logs/stream",
      signal: new AbortController().signal,
      worker: worker(origin),
    })
    await bounded(response.body[Symbol.asyncIterator]().next())

    // When
    await new Promise<void>((resolve) => setTimeout(resolve, 30))

    // Then
    expect(response.body.readableLength).toBeLessThanOrEqual(1024)
    response.cancel()
    await bounded(response.closed)
    await transport.close()
  })

  it("rejects a stream chunk above the configured size policy", async () => {
    // Given
    const origin = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.write(Buffer.alloc(2048, 65))
    })
    const transport = proxy({ maxResponseBytes: 1024 })
    const response = await transport.openStream({
      headers: {},
      method: PublicHttpMethod.GET,
      pathAndQuery: "/v1/logs/stream",
      signal: new AbortController().signal,
      worker: worker(origin),
    })

    // When / Then
    await expect(bounded(response.body[Symbol.asyncIterator]().next()))
      .rejects.toBeInstanceOf(WorkerRestBadResponseError)
    await bounded(response.closed)
    await transport.close()
  })

  it("checks worker generation before exposing each stream chunk", async () => {
    // Given
    const origin = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.write("data: fenced\n\n")
    })
    const transport = proxy({ verifier: new FailingVerifier() })
    const response = await transport.openStream({
      headers: {},
      method: PublicHttpMethod.GET,
      pathAndQuery: "/v1/logs/stream",
      signal: new AbortController().signal,
      worker: worker(origin),
    })

    // When / Then
    await expect(bounded(response.body[Symbol.asyncIterator]().next()))
      .rejects.toBeInstanceOf(WorkerIdentityMismatchError)
    await bounded(response.closed)
    await transport.close()
  })
})
