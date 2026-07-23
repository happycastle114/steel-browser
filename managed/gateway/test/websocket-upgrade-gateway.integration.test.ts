import { createServer } from "node:http"
import type { Duplex } from "node:stream"
import { afterEach, describe, expect, it } from "vitest"
import WebSocket, { WebSocketServer, type RawData } from "ws"
import {
  AllocationIdSchema,
  EventLedger,
  InstanceIdSchema,
  PublicSessionIdSchema,
  WorkerDescriptorSchema,
  WorkerIdSchema,
  WorkerRegistry,
  WorkerRemoteState,
  type WorkerDescriptor,
} from "../src/index.js"
import { PublicRequestSecurity } from "../src/api/public/security.js"
import type { WorkerGenerationVerifier } from "../src/api/public/proxy.js"
import { ManagedWebSocketGateway } from "../src/websocket/upgrade-gateway.js"
import { WebSocketReservationLedger } from "../src/websocket/duplex-proxy.js"
import { FakeClock, upstreamSessionId } from "./test-support.js"

const MANAGER_INSTANCE_ID = "11111111-2222-4333-8444-555555555555"
const SESSION_ID = PublicSessionIdSchema.parse("00000000-0000-4000-8000-000000001001")
const closeTasks: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closeTasks.splice(0).map(async (close) => close()))
})

class CountingVerifier implements WorkerGenerationVerifier {
  public calls = 0

  public async assertCurrent(_worker: WorkerDescriptor): Promise<void> {
    this.calls += 1
  }
}

class CountingLease {
  public releases = 0
  public releasedBeforeSocketClose = false
  private socketClosed = false

  public constructor(socket: Duplex) {
    socket.once("close", () => {
      this.socketClosed = true
    })
  }

  public release(): boolean {
    if (!this.socketClosed) this.releasedBeforeSocketClose = true
    this.releases += 1
    return this.releases === 1
  }
}

function rawDataBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  return Buffer.concat(data)
}

async function upstreamServer(): Promise<{
  readonly connections: () => number
  readonly origin: string
  readonly receivedHeaders: () => Readonly<Record<string, string | string[] | undefined>>
}> {
  let connectionCount = 0
  let headers: Readonly<Record<string, string | string[] | undefined>> = {}
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 })
  server.on("connection", (socket, request) => {
    connectionCount += 1
    headers = request.headers
    socket.on("message", (data, binary) => socket.send(data, { binary }))
  })
  await new Promise<void>((resolve) => server.once("listening", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new TypeError("expected TCP address")
  closeTasks.push(async () => new Promise<void>((resolve) => server.close(() => resolve())))
  return {
    connections: () => connectionCount,
    origin: `http://127.0.0.1:${address.port}`,
    receivedHeaders: () => headers,
  }
}

function registryFor(origin: string): WorkerRegistry {
  const clock = new FakeClock()
  const registry = new WorkerRegistry({ clock, ledger: new EventLedger({ clock }) })
  const worker = WorkerDescriptorSchema.parse({
    workerId: WorkerIdSchema.parse("worker-00"),
    instanceId: InstanceIdSchema.parse("00000000-0000-4000-8000-000000000001"),
    origin,
  })
  registry.commitObservation(registry.beginObservation(worker.workerId), {
    worker,
    remoteState: WorkerRemoteState.IDLE,
    sessions: [],
  })
  const allocationId = AllocationIdSchema.parse("allocation-ws-gateway")
  registry.reserveNext(allocationId)
  registry.bindSession({
    allocationId,
    publicSessionId: SESSION_ID,
    upstreamSessionId: upstreamSessionId(1),
  })
  return registry
}

function security(): PublicRequestSecurity {
  return new PublicRequestSecurity({
    allowedOrigins: [],
    originByHost: { "public.steel.example": "https://public.steel.example" },
    authenticate: async (headers) => {
      if (headers["authorization"] !== "Bearer accepted") throw new TypeError("not authenticated")
    },
  })
}

async function publicServer(
  gateway: ManagedWebSocketGateway,
  leases: CountingLease[],
): Promise<string> {
  const server = createServer()
  server.on("upgrade", (request, socket, head) => {
    const lease = new CountingLease(socket)
    leases.push(lease)
    void gateway.handle({
      connectionReservation: lease,
      head,
      request,
      signal: new AbortController().signal,
      socket,
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new TypeError("expected TCP address")
  closeTasks.push(async () => new Promise<void>((resolve) => server.close(() => resolve())))
  return `ws://127.0.0.1:${address.port}`
}

function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      headers: {
        authorization: "Bearer accepted",
        cookie: "CF_Authorization=secret",
        host: "public.steel.example",
        "x-managed-forged": "forged",
        "x-steel-managed-forged": "forged",
      },
    })
    socket.once("open", () => resolve(socket))
    socket.once("error", reject)
  })
}

describe("ManagedWebSocketGateway integration", () => {
  it("rejects exhausted capacity before a worker attach and releases ingress once", async () => {
    // Given
    const upstream = await upstreamServer()
    const ledger = new WebSocketReservationLedger({
      bufferBytes: 128,
      limitBytes: 1_048_960,
      limitCount: 1,
      messageBytes: 64,
    })
    const held = ledger.tryReserve()
    if (held === undefined) throw new TypeError("expected initial capacity")
    const gateway = new ManagedWebSocketGateway({
      bufferBytes: 128,
      closeTimeoutMilliseconds: 25,
      handshakeTimeoutMilliseconds: 100,
      identity: { managerInstanceId: MANAGER_INSTANCE_ID, poolId: "blue" },
      ledger,
      messageBytes: 64,
      retryAfterSeconds: 1,
      registry: registryFor(upstream.origin),
      security: security(),
      verifier: new CountingVerifier(),
    })
    const leases: CountingLease[] = []
    const origin = await publicServer(gateway, leases)

    // When
    const response = await new Promise<{ readonly body: string; readonly statusCode: number }>(
      (resolve, reject) => {
        const socket = new WebSocket(`${origin}/?sessionId=${SESSION_ID}`, {
          headers: { authorization: "Bearer accepted", host: "public.steel.example" },
        })
        socket.once("unexpected-response", (_request, incoming) => {
          const chunks: Buffer[] = []
          incoming.on("data", (chunk: Buffer) => chunks.push(chunk))
          incoming.on("end", () => resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            statusCode: incoming.statusCode ?? 0,
          }))
        })
        socket.once("error", reject)
      },
    )

    // Then
    expect(response.statusCode).toBe(503)
    expect(JSON.parse(response.body)).toMatchObject({ error: { code: "MANAGED_WS_CAPACITY" } })
    expect(upstream.connections()).toBe(0)
    expect(leases[0]?.releases).toBe(1)
    expect(leases[0]?.releasedBeforeSocketClose).toBe(false)
    held.release()
    await gateway.close()
  })

  it("attaches the fenced worker without Access headers and releases both ledgers", async () => {
    // Given
    const upstream = await upstreamServer()
    const ledger = new WebSocketReservationLedger({
      bufferBytes: 1024,
      limitBytes: 1_052_672,
      limitCount: 1,
      messageBytes: 1024,
    })
    const verifier = new CountingVerifier()
    const gateway = new ManagedWebSocketGateway({
      bufferBytes: 1024,
      closeTimeoutMilliseconds: 25,
      handshakeTimeoutMilliseconds: 100,
      identity: { managerInstanceId: MANAGER_INSTANCE_ID, poolId: "blue" },
      ledger,
      messageBytes: 1024,
      retryAfterSeconds: 1,
      registry: registryFor(upstream.origin),
      security: security(),
      verifier,
    })
    const leases: CountingLease[] = []
    const origin = await publicServer(gateway, leases)
    const socket = await openSocket(`${origin}/?sessionId=${SESSION_ID}`)
    const echoed = new Promise<Buffer>((resolve) => {
      socket.once("message", (data) => resolve(rawDataBuffer(data)))
    })

    // When
    socket.send("isolated")
    const body = await echoed
    const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()))
    socket.close(1000, "complete")
    await closed

    // Then
    expect(body.toString()).toBe("isolated")
    expect(verifier.calls).toBe(2)
    expect(upstream.connections()).toBe(1)
    expect(upstream.receivedHeaders()).toMatchObject({
      "x-managed-manager-instance-id": MANAGER_INSTANCE_ID,
      "x-managed-pool-id": "blue",
    })
    expect(upstream.receivedHeaders()["authorization"]).toBeUndefined()
    expect(upstream.receivedHeaders()["cookie"]).toBeUndefined()
    expect(upstream.receivedHeaders()["x-managed-forged"]).toBeUndefined()
    expect(upstream.receivedHeaders()["x-steel-managed-forged"]).toBeUndefined()
    await expect.poll(() => ledger.snapshot().activeCount).toBe(0)
    expect(leases[0]?.releases).toBe(1)
    expect(leases[0]?.releasedBeforeSocketClose).toBe(false)
    await gateway.close()
  })
})
