import { createServer, type Server } from "node:http"
import { connect } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import WebSocket, { WebSocketServer } from "ws"
import {
  AllocationIdSchema,
  EventLedger,
  InstanceIdSchema,
  PublicRequestSecurity,
  PublicSessionIdSchema,
  WebSocketReservationLedger,
  WorkerDescriptorSchema,
  WorkerIdSchema,
  WorkerIdentityMismatchError,
  WorkerRegistry,
  WorkerRemoteState,
  type WorkerDescriptor,
  type WorkerGenerationVerifier,
} from "../src/index.js"
import { ManagedWebSocketGateway } from "../src/websocket/upgrade-gateway.js"
import { FakeClock, upstreamSessionId } from "./test-support.js"

const SESSION_ID = PublicSessionIdSchema.parse("00000000-0000-4000-8000-000000001001")
const closeTasks: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closeTasks.splice(0).map(async (close) => close()))
})

class GenerationVerifier implements WorkerGenerationVerifier {
  public calls = 0
  public failOnCall: number | undefined

  public async assertCurrent(worker: WorkerDescriptor): Promise<void> {
    this.calls += 1
    if (this.calls === this.failOnCall) {
      throw new WorkerIdentityMismatchError(worker.workerId, worker.instanceId)
    }
  }
}

class GatedGenerationVerifier implements WorkerGenerationVerifier {
  private continueSecond: (() => void) | undefined
  private readonly secondGate = new Promise<void>((resolve) => {
    this.continueSecond = resolve
  })
  private secondStartedResolve: (() => void) | undefined
  public readonly secondStarted = new Promise<void>((resolve) => {
    this.secondStartedResolve = resolve
  })
  private calls = 0

  public async assertCurrent(_worker: WorkerDescriptor): Promise<void> {
    this.calls += 1
    if (this.calls !== 2) return
    this.secondStartedResolve?.()
    await this.secondGate
  }

  public release(): void {
    this.continueSecond?.()
  }
}

class Lease {
  public releases = 0
  public release(): boolean {
    this.releases += 1
    return this.releases === 1
  }
}

async function upstream(): Promise<{
  readonly activeConnections: () => number
  readonly closeConnection: (abrupt: boolean) => void
  readonly connections: () => number
  readonly idle: () => Promise<void>
  readonly origin: string
  readonly protocol: () => string
}> {
  let activeConnections = 0
  const idleWaiters: Array<() => void> = []
  let connections = 0
  let protocol = ""
  let privateLocation = ""
  let connection: WebSocket | undefined
  const server = new WebSocketServer({
    handleProtocols: (protocols) => protocols.has("steel-v1") ? "steel-v1" : false,
    port: 0,
  })
  server.on("headers", (headers) => {
    headers.push(
      "x-upstream-additive: preserved",
      "x-managed-private: remove-me",
      "x-steel-managed-private: remove-me",
      `x-worker-location: ${privateLocation}`,
      "set-cookie: worker-token=sensitive-canary; HttpOnly",
      'www-authenticate: Bearer realm="private-worker"',
    )
  })
  server.on("connection", (socket) => {
    activeConnections += 1
    connections += 1
    connection = socket
    protocol = socket.protocol
    socket.on("message", (data, binary) => socket.send(data, { binary }))
    socket.once("close", () => {
      activeConnections -= 1
      if (activeConnections === 0) {
        for (const resolve of idleWaiters.splice(0)) resolve()
      }
    })
  })
  await new Promise<void>((resolve) => server.once("listening", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new TypeError("expected TCP address")
  privateLocation = `HTTP://LOCALHOST:${address.port}/private`
  closeTasks.push(async () => new Promise<void>((resolve) => server.close(() => resolve())))
  return {
    activeConnections: () => activeConnections,
    closeConnection: (abrupt) => {
      if (abrupt) connection?.terminate()
      else connection?.close(1000)
    },
    connections: () => connections,
    idle: async () => {
      if (activeConnections === 0) return
      await new Promise<void>((resolve) => idleWaiters.push(resolve))
    },
    origin: `http://localhost:${address.port}`,
    protocol: () => protocol,
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
  const allocationId = AllocationIdSchema.parse("allocation-upgrade-compat")
  registry.reserveNext(allocationId)
  registry.bindSession({ allocationId, publicSessionId: SESSION_ID, upstreamSessionId: upstreamSessionId(1) })
  return registry
}

function gateway(origin: string, verifier: GenerationVerifier): ManagedWebSocketGateway {
  return gatewayFixture(origin, verifier).transport
}

function gatewayFixture(
  origin: string,
  verifier: WorkerGenerationVerifier,
): { readonly ledger: WebSocketReservationLedger; readonly transport: ManagedWebSocketGateway } {
  const ledger = new WebSocketReservationLedger({
    bufferBytes: 1024,
    limitBytes: 4_194_304,
    limitCount: 1,
    messageBytes: 1024,
  })
  const transport = new ManagedWebSocketGateway({
    handshakeTimeoutMilliseconds: 100,
    bufferBytes: 1024,
    closeTimeoutMilliseconds: 25,
    identity: {
      managerInstanceId: "11111111-2222-4333-8444-555555555555",
      poolId: "blue",
    },
    ledger,
    messageBytes: 1024,
    retryAfterSeconds: 1,
    registry: registryFor(origin),
    security: new PublicRequestSecurity({
      allowedOrigins: [],
      originByHost: { "public.steel.example": "https://public.steel.example" },
      authenticate: async () => undefined,
    }),
    verifier,
  })
  return { ledger, transport }
}

async function publicOrigin(
  transport: ManagedWebSocketGateway,
  leases: Lease[],
  signal = new AbortController().signal,
): Promise<string> {
  const server = createServer()
  server.on("upgrade", (request, socket, head) => {
    const lease = new Lease()
    leases.push(lease)
    void transport.handle({
      connectionReservation: lease,
      head,
      request,
      signal,
      socket,
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new TypeError("expected TCP address")
  closeTasks.push(async () => closeServer(server))
  return `ws://127.0.0.1:${address.port}`
}

function rejectedStatus(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { host: "public.steel.example" } })
    socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0))
    socket.once("open", () => {
      socket.terminate()
      reject(new TypeError("unexpected websocket upgrade"))
    })
    socket.once("error", reject)
  })
}

function malformedProtocolStatus(url: string): Promise<number> {
  const target = new URL(url)
  return new Promise((resolve, reject) => {
    let response = ""
    let settled = false
    const socket = connect(Number(target.port), target.hostname, () => {
      socket.write([
        `GET ${target.pathname}${target.search} HTTP/1.1`,
        "Host: public.steel.example",
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Version: 13",
      ].join("\r\n") + "\r\n\r\n")
    })
    socket.on("data", (chunk) => {
      response += chunk.toString("latin1")
      const match = /^HTTP\/1\.1 ([0-9]{3}) /u.exec(response)
      if (match?.[1] === undefined || settled) return
      settled = true
      resolve(Number(match[1]))
      socket.destroy()
    })
    socket.once("error", (error) => {
      if (!settled) reject(error)
    })
    socket.once("close", () => {
      if (!settled) reject(new TypeError("malformed handshake closed without a response"))
    })
  })
}

const UpgradeOutcomeKind = {
  OPENED: "OPENED",
  REJECTED: "REJECTED",
} as const

function upgradeOutcome(url: string): Promise<
  | { readonly kind: typeof UpgradeOutcomeKind.OPENED }
  | { readonly kind: typeof UpgradeOutcomeKind.REJECTED; readonly statusCode: number }
> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url, { headers: { host: "public.steel.example" } })
    socket.once("unexpected-response", (_request, response) => {
      response.resume()
      resolve({ kind: UpgradeOutcomeKind.REJECTED, statusCode: response.statusCode ?? 0 })
    })
    socket.once("open", () => {
      socket.terminate()
      resolve({ kind: UpgradeOutcomeKind.OPENED })
    })
    socket.once("error", () => undefined)
  })
}

async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out`)), 500)
      timer.unref()
    }),
  ])
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

describe("ManagedWebSocketGateway upgrade compatibility", () => {
  it("forwards the selected subprotocol and safe upstream upgrade headers", async () => {
    // Given
    const worker = await upstream()
    const transport = gateway(worker.origin, new GenerationVerifier())
    const origin = await publicOrigin(transport, [])
    let upgradeHeaders: Readonly<Record<string, string | string[] | undefined>> = {}
    const socket = new WebSocket(`${origin}/?sessionId=${SESSION_ID}`, ["fallback", "steel-v1"], {
      headers: { host: "public.steel.example" },
    })
    socket.once("upgrade", (response) => {
      upgradeHeaders = response.headers
    })

    try {
      // When
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve)
        socket.once("error", reject)
      })

      // Then
      expect(socket.protocol).toBe("steel-v1")
      expect(worker.protocol()).toBe("steel-v1")
      expect(upgradeHeaders["x-upstream-additive"]).toBe("preserved")
      expect(upgradeHeaders["x-managed-private"]).toBeUndefined()
      expect(upgradeHeaders["x-steel-managed-private"]).toBeUndefined()
      expect(upgradeHeaders["x-worker-location"]).toBeUndefined()
      expect(upgradeHeaders["set-cookie"]).toBeUndefined()
      expect(upgradeHeaders["www-authenticate"]).toBeUndefined()
    } finally {
      socket.terminate()
      await transport.close()
    }
  })

  it("rejects a generation change after worker open and releases both reservations once", async () => {
    // Given
    const worker = await upstream()
    const verifier = new GenerationVerifier()
    verifier.failOnCall = 2
    const transport = gateway(worker.origin, verifier)
    const leases: Lease[] = []
    const origin = await publicOrigin(transport, leases)

    // When
    const statusCode = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(`${origin}/?sessionId=${SESSION_ID}`, {
        headers: { host: "public.steel.example" },
      })
      socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0))
      socket.once("error", reject)
    })

    // Then
    expect(statusCode).toBe(410)
    expect(worker.connections()).toBe(1)
    expect(leases[0]?.releases).toBe(1)
    await transport.close()
  })

  it.each([
    { abrupt: false, terminal: "close" },
    { abrupt: true, terminal: "reset" },
  ])("rejects a worker $terminal during the second generation fence", async ({ abrupt }) => {
    // Given
    const worker = await upstream()
    const verifier = new GatedGenerationVerifier()
    const { ledger, transport } = gatewayFixture(worker.origin, verifier)
    const leases: Lease[] = []
    const origin = await publicOrigin(transport, leases)
    const outcome = upgradeOutcome(`${origin}/?sessionId=${SESSION_ID}`)
    await verifier.secondStarted

    // When
    worker.closeConnection(abrupt)
    await new Promise<void>((resolve) => setImmediate(resolve))
    verifier.release()

    // Then
    await expect(bounded(outcome, "public upgrade")).resolves.toEqual({
      kind: UpgradeOutcomeKind.REJECTED,
      statusCode: 502,
    })
    await expect(bounded(transport.close(), "gateway close")).resolves.toBeUndefined()
    expect(ledger.snapshot()).toMatchObject({ activeCount: 0, reservedBytes: 0 })
    expect(leases[0]?.releases).toBe(1)
  })

  it("closes a malformed handshake without attaching a worker", async () => {
    // Given
    const worker = await upstream()
    const transport = gateway(worker.origin, new GenerationVerifier())
    const leases: Lease[] = []
    const origin = await publicOrigin(transport, leases)

    // When
    const statusCode = await rejectedStatus(`${origin}/v1/sessions/%zz/cast`)

    // Then
    expect(statusCode).toBe(404)
    expect(worker.connections()).toBe(0)
    expect(leases[0]?.releases).toBe(1)
    await transport.close()
  })

  it("releases an attached worker when the public handshake omits its key", async () => {
    // Given
    const worker = await upstream()
    const { ledger, transport } = gatewayFixture(worker.origin, new GenerationVerifier())
    const leases: Lease[] = []
    const origin = await publicOrigin(transport, leases)

    // When
    const statusCode = await bounded(
      malformedProtocolStatus(`${origin}/?sessionId=${SESSION_ID}`),
      "malformed public handshake",
    )
    await bounded(transport.close(), "gateway close")
    await bounded(worker.idle(), "worker cleanup")

    // Then
    expect(statusCode).toBe(400)
    expect(worker.connections()).toBe(1)
    expect(worker.activeConnections()).toBe(0)
    expect(ledger.snapshot()).toMatchObject({ activeCount: 0, reservedBytes: 0 })
    expect(leases[0]?.releases).toBe(1)
  })

  it("rejects an already-aborted handshake before reserving or attaching", async () => {
    // Given
    const worker = await upstream()
    const transport = gateway(worker.origin, new GenerationVerifier())
    const abort = new AbortController()
    abort.abort()
    const leases: Lease[] = []
    const origin = await publicOrigin(transport, leases, abort.signal)

    try {
      // When
      const statusCode = await rejectedStatus(`${origin}/?sessionId=${SESSION_ID}`)

      // Then
      expect(statusCode).toBe(502)
      expect(worker.connections()).toBe(0)
      expect(leases[0]?.releases).toBe(1)
    } finally {
      await transport.close()
    }
  })
})
