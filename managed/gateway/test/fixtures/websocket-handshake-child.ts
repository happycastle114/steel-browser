import { createServer as createHttpServer, type Server as HttpServer } from "node:http"
import { createServer as createTcpServer, type Server as TcpServer, type Socket } from "node:net"
import WebSocket from "ws"
import { z } from "zod"
import {
  AllocationIdSchema,
  EventLedger,
  InstanceIdSchema,
  ManagedWebSocketGateway,
  PublicRequestSecurity,
  PublicSessionIdSchema,
  WebSocketReservationLedger,
  WorkerDescriptorSchema,
  WorkerIdSchema,
  WorkerRegistry,
  WorkerRemoteState,
  type WorkerDescriptor,
  type WorkerGenerationVerifier,
} from "../../src/index.js"
import { FakeClock, upstreamSessionId } from "../test-support.js"

const Scenario = {
  ABORT: "ABORT",
  NON_101: "NON_101",
  TCP_RESET: "TCP_RESET",
  TIMEOUT: "TIMEOUT",
} as const
const ScenarioSchema = z.enum([
  Scenario.ABORT,
  Scenario.NON_101,
  Scenario.TCP_RESET,
  Scenario.TIMEOUT,
])
type Scenario = z.infer<typeof ScenarioSchema>

const SESSION_ID = PublicSessionIdSchema.parse("00000000-0000-4000-8000-000000001001")
const sockets = new Set<Socket>()

class CurrentVerifier implements WorkerGenerationVerifier {
  public async assertCurrent(_worker: WorkerDescriptor): Promise<void> {}
}

class IngressLease {
  public releases = 0

  public release(): boolean {
    this.releases += 1
    return this.releases === 1
  }
}

type ProbeResult = {
  readonly completed: boolean
  readonly ingressReleases: number
  readonly reservationActive: number
  readonly reservationBytes: number
  readonly statusCode: number
  readonly uncaught: number
}

async function main(): Promise<void> {
  const scenario = ScenarioSchema.parse(process.argv[2])
  let uncaught = 0
  process.on("uncaughtException", () => {
    uncaught += 1
  })
  process.on("unhandledRejection", () => {
    uncaught += 1
  })
  const abort = new AbortController()
  const upstream = await startUpstream(scenario, abort)
  const ledger = new WebSocketReservationLedger({
    bufferBytes: 128,
    limitBytes: 4_194_304,
    limitCount: 1,
    messageBytes: 64,
  })
  const gateway = new ManagedWebSocketGateway({
    bufferBytes: 128,
    closeTimeoutMilliseconds: 50,
    handshakeTimeoutMilliseconds: 40,
    identity: {
      managerInstanceId: "11111111-2222-4333-8444-555555555555",
      poolId: "blue",
    },
    ledger,
    messageBytes: 64,
    registry: registryFor(upstream.origin),
    retryAfterSeconds: 1,
    security: new PublicRequestSecurity({
      allowedOrigins: [],
      authenticate: async () => undefined,
      originByHost: { "public.steel.example": "https://public.steel.example" },
    }),
    verifier: new CurrentVerifier(),
  })
  const lease = new IngressLease()
  const publicServer = createHttpServer()
  publicServer.on("upgrade", (request, socket, head) => {
    void gateway.handle({
      connectionReservation: lease,
      head,
      request,
      signal: abort.signal,
      socket,
    })
  })
  await listenHttp(publicServer)
  const address = publicServer.address()
  if (address === null || typeof address === "string") throw new TypeError("expected TCP address")

  const failSafe = setTimeout(() => {
    writeResult({
      completed: false,
      ingressReleases: lease.releases,
      reservationActive: ledger.snapshot().activeCount,
      reservationBytes: ledger.snapshot().reservedBytes,
      statusCode: 0,
      uncaught,
    }, true)
  }, 750)
  failSafe.unref()
  const statusCode = await rejectedStatus(
    `ws://127.0.0.1:${address.port}/?sessionId=${SESSION_ID}`,
  )
  await new Promise<void>((resolve) => setImmediate(resolve))
  await gateway.close()
  publicServer.closeAllConnections()
  await closeHttp(publicServer)
  await upstream.close()
  clearTimeout(failSafe)
  writeResult({
    completed: true,
    ingressReleases: lease.releases,
    reservationActive: ledger.snapshot().activeCount,
    reservationBytes: ledger.snapshot().reservedBytes,
    statusCode,
    uncaught,
  }, false)
}

async function startUpstream(
  scenario: Scenario,
  abort: AbortController,
): Promise<{ readonly close: () => Promise<void>; readonly origin: string }> {
  if (scenario === Scenario.NON_101) {
    const server = createHttpServer()
    server.on("upgrade", (_request, socket) => {
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
    })
    await listenHttp(server)
    const address = server.address()
    if (address === null || typeof address === "string") throw new TypeError("expected TCP address")
    return {
      close: async () => {
        server.closeAllConnections()
        await closeHttp(server)
      },
      origin: `http://127.0.0.1:${address.port}`,
    }
  }
  const server = createTcpServer((socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    if (scenario === Scenario.TCP_RESET) socket.destroy()
    if (scenario === Scenario.ABORT) abort.abort()
  })
  await listenTcp(server)
  const address = server.address()
  if (address === null || typeof address === "string") throw new TypeError("expected TCP address")
  return {
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await closeTcp(server)
    },
    origin: `http://127.0.0.1:${address.port}`,
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
    remoteState: WorkerRemoteState.IDLE,
    sessions: [],
    worker,
  })
  const allocationId = AllocationIdSchema.parse("allocation-handshake-child")
  registry.reserveNext(allocationId)
  registry.bindSession({
    allocationId,
    publicSessionId: SESSION_ID,
    upstreamSessionId: upstreamSessionId(1),
  })
  return registry
}

function rejectedStatus(url: string): Promise<number> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url, {
      headers: { host: "public.steel.example" },
    })
    socket.once("unexpected-response", (_request, response) => {
      response.resume()
      response.once("end", () => resolve(response.statusCode ?? 0))
    })
    socket.once("error", () => {
      if (socket.readyState === WebSocket.CLOSED) resolve(0)
    })
  })
}

function listenHttp(server: HttpServer): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
}

function closeHttp(server: HttpServer): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

function listenTcp(server: TcpServer): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
}

function closeTcp(server: TcpServer): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

function writeResult(result: ProbeResult, exit: boolean): void {
  process.stdout.write(`${JSON.stringify(result)}\n`, () => {
    if (exit) process.exit(0)
  })
}

await main()
