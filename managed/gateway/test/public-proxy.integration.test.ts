import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { afterEach, describe, expect, it } from "vitest"
import {
  InstanceIdSchema,
  WorkerDescriptorSchema,
  WorkerIdentityMismatchError,
  WorkerIdSchema,
  type WorkerDescriptor,
} from "../src/index.js"
import { PublicHttpMethod } from "../src/api/public/schemas.js"
import {
  WorkerRestProxy,
  WorkerRestTimeoutError,
  type WorkerGenerationVerifier,
} from "../src/api/public/proxy.js"

const MANAGER_INSTANCE_ID = "11111111-2222-4333-8444-555555555555"
const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

class CountingVerifier implements WorkerGenerationVerifier {
  public calls = 0
  public failOnCall: number | undefined

  public async assertCurrent(worker: WorkerDescriptor): Promise<void> {
    this.calls += 1
    if (this.calls === this.failOnCall) {
      throw new WorkerIdentityMismatchError(worker.workerId, worker.instanceId)
    }
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

describe("WorkerRestProxy integration", () => {
  it("preserves status/body/safe headers while stripping Access and injecting private identity", async () => {
    // Given
    let observedHeaders: IncomingMessage["headers"] = {}
    let observedUrl = ""
    const origin = await listen((request, response) => {
      observedHeaders = request.headers
      observedUrl = request.url ?? ""
      response.writeHead(200, {
        connection: "x-private-response",
        "content-type": "application/octet-stream",
        "set-cookie": "worker-token=sensitive-canary; HttpOnly",
        "www-authenticate": 'Bearer realm="private-worker"',
        "x-private-response": "remove-me",
        "x-managed-worker-id": "worker-00",
        "x-steel-managed-worker-secret": "remove-me",
        "x-safe-additive": "retained",
      })
      response.end(Buffer.from([0, 1, 2, 3]))
    })
    const verifier = new CountingVerifier()
    const proxy = new WorkerRestProxy({
      identity: { managerInstanceId: MANAGER_INSTANCE_ID, poolId: "blue" },
      maxResponseBytes: 1024,
      maxRequestBytes: 1024,
      timeoutMilliseconds: 1000,
      verifier,
    })

    // When
    const result = await proxy.send({
      body: Buffer.from("request"),
      headers: {
        authorization: "Bearer access-secret",
        connection: "keep-alive, x-secret",
        cookie: "CF_Authorization=secret",
        "cf-access-jwt-assertion": "access-jwt-secret",
        "content-type": "application/octet-stream",
        "x-managed-client-forged": "forged",
        "x-steel-managed-client-forged": "forged",
        "x-safe-additive": "forwarded",
        "x-secret": "remove-me",
        "x-steel-session-id": "00000000-0000-4000-8000-000000001001",
      },
      method: PublicHttpMethod.POST,
      pathAndQuery: "/v1/screenshot?fullPage=true",
      signal: new AbortController().signal,
      worker: worker(origin),
    })
    await proxy.close()

    // Then
    expect(result.statusCode).toBe(200)
    expect(result.body).toEqual(Buffer.from([0, 1, 2, 3]))
    expect(result.headers["x-safe-additive"]).toBe("retained")
    expect(result.headers["x-managed-worker-id"]).toBeUndefined()
    expect(result.headers["x-steel-managed-worker-secret"]).toBeUndefined()
    expect(result.headers["x-private-response"]).toBeUndefined()
    expect(result.headers["set-cookie"]).toBeUndefined()
    expect(result.headers["www-authenticate"]).toBeUndefined()
    expect(observedUrl).toBe("/v1/screenshot?fullPage=true")
    expect(observedHeaders["x-managed-pool-id"]).toBe("blue")
    expect(observedHeaders["x-managed-manager-instance-id"]).toBe(MANAGER_INSTANCE_ID)
    expect(observedHeaders["x-safe-additive"]).toBe("forwarded")
    expect(observedHeaders["authorization"]).toBeUndefined()
    expect(observedHeaders["cf-access-jwt-assertion"]).toBeUndefined()
    expect(observedHeaders["cookie"]).toBeUndefined()
    expect(observedHeaders["x-steel-session-id"]).toBeUndefined()
    expect(observedHeaders["x-managed-client-forged"]).toBeUndefined()
    expect(observedHeaders["x-steel-managed-client-forged"]).toBeUndefined()
    expect(observedHeaders["x-secret"]).toBeUndefined()
    expect(verifier.calls).toBe(2)
  })

  it("fails closed when the worker generation changes after the response", async () => {
    // Given
    const origin = await listen((_request, response) => response.end("ok"))
    const verifier = new CountingVerifier()
    verifier.failOnCall = 2
    const proxy = new WorkerRestProxy({
      identity: { managerInstanceId: MANAGER_INSTANCE_ID, poolId: "blue" },
      maxResponseBytes: 1024,
      maxRequestBytes: 1024,
      timeoutMilliseconds: 1000,
      verifier,
    })

    // When
    const request = proxy.send({
      headers: {},
      method: PublicHttpMethod.GET,
      pathAndQuery: "/v1/sessions/00000000-0000-4000-8000-000000001001/context",
      signal: new AbortController().signal,
      worker: worker(origin),
    })

    // Then
    await expect(request).rejects.toBeInstanceOf(WorkerIdentityMismatchError)
    await proxy.close()
  })

  it("aborts a bounded upstream request timeout", async () => {
    // Given
    const origin = await listen(() => undefined)
    const proxy = new WorkerRestProxy({
      identity: { managerInstanceId: MANAGER_INSTANCE_ID, poolId: "blue" },
      maxResponseBytes: 1024,
      maxRequestBytes: 1024,
      timeoutMilliseconds: 20,
      verifier: new CountingVerifier(),
    })

    // When
    const request = proxy.send({
      headers: {},
      method: PublicHttpMethod.GET,
      pathAndQuery: "/v1/logs/stats",
      signal: new AbortController().signal,
      worker: worker(origin),
    })

    // Then
    await expect(request).rejects.toBeInstanceOf(WorkerRestTimeoutError)
    await proxy.close()
  })

  it.each([400, 503])("preserves a bounded upstream HTTP %i response", async (statusCode) => {
    // Given
    const origin = await listen((_request, response) => {
      response.writeHead(statusCode, {
        "content-type": "application/json; charset=utf-8",
        "retry-after": "7",
      })
      response.end(JSON.stringify({ additive: true, statusCode }))
    })
    const verifier = new CountingVerifier()
    const proxy = new WorkerRestProxy({
      identity: { managerInstanceId: MANAGER_INSTANCE_ID, poolId: "blue" },
      maxResponseBytes: 1024,
      maxRequestBytes: 1024,
      timeoutMilliseconds: 1000,
      verifier,
    })

    // When
    const result = await proxy.send({
      headers: {},
      method: PublicHttpMethod.GET,
      pathAndQuery: "/v1/sessions",
      signal: new AbortController().signal,
      worker: worker(origin),
    })
    await proxy.close()

    // Then
    expect(result.statusCode).toBe(statusCode)
    expect(result.headers["retry-after"]).toBe("7")
    expect(JSON.parse(result.body.toString("utf8"))).toEqual({ additive: true, statusCode })
    expect(verifier.calls).toBe(2)
  })

  it("rejects an oversized public request body before worker verification or I/O", async () => {
    // Given
    let requests = 0
    const origin = await listen((_request, response) => {
      requests += 1
      response.end("unexpected")
    })
    const verifier = new CountingVerifier()
    const proxy = new WorkerRestProxy({
      identity: { managerInstanceId: MANAGER_INSTANCE_ID, poolId: "blue" },
      maxResponseBytes: 4,
      maxRequestBytes: 4,
      timeoutMilliseconds: 1000,
      verifier,
    })

    // When
    const request = proxy.send({
      body: Buffer.from("12345"),
      headers: {},
      method: PublicHttpMethod.POST,
      pathAndQuery: "/v1/screenshot",
      signal: new AbortController().signal,
      worker: worker(origin),
    })

    // Then
    try {
      await expect(request).rejects.toThrow("public request body exceeded capacity")
      expect(requests).toBe(0)
      expect(verifier.calls).toBe(0)
    } finally {
      await proxy.close()
    }
  })

  it("rejects dot-segment traversal before the Selenium wildcard can escape upstream", async () => {
    // Given
    let requests = 0
    const origin = await listen((_request, response) => {
      requests += 1
      response.end("unexpected")
    })
    const verifier = new CountingVerifier()
    const proxy = new WorkerRestProxy({
      identity: { managerInstanceId: MANAGER_INSTANCE_ID, poolId: "blue" },
      maxResponseBytes: 1024,
      maxRequestBytes: 1024,
      timeoutMilliseconds: 1000,
      verifier,
    })

    // When
    const request = proxy.send({
      headers: {},
      method: PublicHttpMethod.POST,
      pathAndQuery: "/selenium/wd/../../v1/sessions",
      signal: new AbortController().signal,
      worker: worker(origin),
    })

    // Then
    try {
      await expect(request).rejects.toThrow("worker returned an unusable response")
      expect(requests).toBe(0)
      expect(verifier.calls).toBe(0)
    } finally {
      await proxy.close()
    }
  })

  it.each([
    PublicHttpMethod.PUT,
    PublicHttpMethod.PATCH,
  ])("forwards concrete Selenium %s methods through the ALL route", async (method) => {
    // Given
    let observedMethod = ""
    const origin = await listen((request, response) => {
      observedMethod = request.method ?? ""
      response.end("ok")
    })
    const proxy = new WorkerRestProxy({
      identity: { managerInstanceId: MANAGER_INSTANCE_ID, poolId: "blue" },
      maxResponseBytes: 1024,
      maxRequestBytes: 1024,
      timeoutMilliseconds: 1000,
      verifier: new CountingVerifier(),
    })

    // When
    await proxy.send({
      body: Buffer.from("{}"),
      headers: { "content-type": "application/json" },
      method,
      pathAndQuery: "/selenium/wd/session/managed/element",
      signal: new AbortController().signal,
      worker: worker(origin),
    })
    await proxy.close()

    // Then
    expect(observedMethod).toBe(method)
  })
})
