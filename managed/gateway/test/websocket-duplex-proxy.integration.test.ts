import { afterEach, describe, expect, it } from "vitest"
import WebSocket, { WebSocketServer, type RawData } from "ws"
import {
  WEB_SOCKET_FIXED_OVERHEAD_BYTES,
  WebSocketReservationLedger,
  proxyWebSockets,
} from "../src/websocket/duplex-proxy.js"

const servers: WebSocketServer[] = []
const sockets: WebSocket[] = []

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate()
  await Promise.all(servers.splice(0).map(async (server) => new Promise<void>((resolve) => {
    server.close(() => resolve())
  })))
})

function startServer(
  connection: (socket: WebSocket, requestPath: string) => void,
): Promise<{ readonly server: WebSocketServer; readonly url: string }> {
  return new Promise((resolve) => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 })
    servers.push(server)
    server.once("listening", () => {
      const address = server.address()
      if (address === null || typeof address === "string") {
        throw new TypeError("expected a TCP websocket address")
      }
      server.on("connection", (socket, request) => {
        sockets.push(socket)
        connection(socket, request.url ?? "")
      })
      resolve({ server, url: `ws://127.0.0.1:${address.port}` })
    })
  })
}

function openedAndReady(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    sockets.push(socket)
    socket.once("message", (data) => {
      if (data.toString() === "ready") resolve(socket)
      else reject(new TypeError("expected websocket readiness marker"))
    })
    socket.once("error", reject)
  })
}

function nextMessage(socket: WebSocket): Promise<{ readonly data: Buffer; readonly binary: boolean }> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data, binary) => resolve({ data: rawDataBuffer(data), binary }))
    socket.once("error", reject)
  })
}

function rawDataBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  return Buffer.concat(data)
}

function nextClose(socket: WebSocket): Promise<{ readonly code: number; readonly reason: string }> {
  return new Promise((resolve) => {
    socket.once("close", (code, reason) => resolve({ code, reason: reason.toString("utf8") }))
  })
}

async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out`)), 2_000)
  })
  try {
    return await Promise.race([promise, expired])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

async function waitForCount(
  values: readonly unknown[],
  count: number,
  label: () => string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const interval = setInterval(() => {
      if (values.length !== count) return
      clearInterval(interval)
      clearTimeout(timeout)
      resolve()
    }, 10)
    const timeout = setTimeout(() => {
      clearInterval(interval)
      reject(new Error(`${label()} timed out (${values.length}/${count})`))
    }, 2_000)
  })
}

describe("proxyWebSockets integration", () => {
  it("preserves 100 ordered isolated messages, binary frames, control frames, and reservations", async () => {
    // Given
    const messageBytes = 1024
    const bufferBytes = 4096
    const reservationBytes = (2 * messageBytes) + (2 * bufferBytes) + WEB_SOCKET_FIXED_OVERHEAD_BYTES
    const ledger = new WebSocketReservationLedger({
      bufferBytes,
      limitBytes: reservationBytes * 2,
      limitCount: 2,
      messageBytes,
    })
    const pingTargets: string[] = []
    const upstreamMessageCounts = { A: 0, B: 0 }
    const upstream = await startServer((socket, path) => {
      const prefix = path === "/a" ? "A" : "B"
      socket.on("message", (data, binary) => {
        upstreamMessageCounts[prefix] += 1
        socket.send(binary ? data : `${prefix}:${data.toString()}`, { binary })
      })
      socket.on("ping", () => pingTargets.push(prefix))
    })
    const publicServer = await startServer((publicSocket, path) => {
      const lease = ledger.tryReserve()
      if (lease === undefined) throw new TypeError("expected websocket capacity")
      const workerSocket = new WebSocket(`${upstream.url}${path}`)
      sockets.push(workerSocket)
      workerSocket.once("open", () => {
        proxyWebSockets({
          bufferBytes,
          closeTimeoutMilliseconds: 25,
          messageBytes,
          publicSocket,
          reservation: lease,
          workerSocket,
        })
        publicSocket.send("ready")
      })
    })
    const [clientA, clientB] = await Promise.all([
      openedAndReady(`${publicServer.url}/a`),
      openedAndReady(`${publicServer.url}/b`),
    ])

    // When
    const receivedA: string[] = []
    const receivedB: string[] = []
    const earlyCloses: string[] = []
    clientA.on("message", (data, binary) => {
      if (!binary) receivedA.push(data.toString())
    })
    clientB.on("message", (data, binary) => {
      if (!binary) receivedB.push(data.toString())
    })
    clientA.on("close", (code, reason) => earlyCloses.push(`A:${code}:${reason.toString()}`))
    clientB.on("close", (code, reason) => earlyCloses.push(`B:${code}:${reason.toString()}`))
    for (let index = 0; index < 100; index += 1) {
      clientA.send(`a-${index.toString().padStart(3, "0")}`)
      clientB.send(`b-${index.toString().padStart(3, "0")}`)
    }
    await waitForCount(
      receivedA,
      100,
      () => `stream A upstream=${upstreamMessageCounts.A} closes=${earlyCloses.join(",")}`,
    )
    await waitForCount(
      receivedB,
      100,
      () => `stream B upstream=${upstreamMessageCounts.B} closes=${earlyCloses.join(",")}`,
    )
    const binaryMessage = nextMessage(clientA)
    clientA.send(Buffer.from([0, 1, 2, 3]), { binary: true })
    const binary = await bounded(binaryMessage, "binary echo")
    clientA.ping("control-a")
    await expect.poll(() => pingTargets).toContain("A")
    const closedA = nextClose(clientA)
    const closedB = nextClose(clientB)
    clientA.close(1000, "complete-a")
    clientB.close(1000, "complete-b")

    // Then
    expect(receivedA).toEqual(Array.from({ length: 100 }, (_value, index) => `A:a-${index.toString().padStart(3, "0")}`))
    expect(receivedB).toEqual(Array.from({ length: 100 }, (_value, index) => `B:b-${index.toString().padStart(3, "0")}`))
    expect(binary).toEqual({ data: Buffer.from([0, 1, 2, 3]), binary: true })
    expect(await bounded(closedA, "client A close")).toEqual({ code: 1000, reason: "complete-a" })
    expect(await bounded(closedB, "client B close")).toEqual({ code: 1000, reason: "complete-b" })
    await expect.poll(() => ledger.snapshot().activeCount).toBe(0)
    expect(ledger.snapshot().reservedBytes).toBe(0)
  }, 10_000)

  it("closes both sides with 1009 when a message exceeds the admitted bound", async () => {
    // Given
    const messageBytes = 4
    const bufferBytes = 16
    const reservationBytes = (2 * messageBytes) + (2 * bufferBytes) + WEB_SOCKET_FIXED_OVERHEAD_BYTES
    const ledger = new WebSocketReservationLedger({
      bufferBytes,
      limitBytes: reservationBytes,
      limitCount: 1,
      messageBytes,
    })
    const worker = await startServer(() => undefined)
    const publicServer = await startServer((publicSocket) => {
      const lease = ledger.tryReserve()
      if (lease === undefined) throw new TypeError("expected websocket capacity")
      const workerSocket = new WebSocket(worker.url)
      sockets.push(workerSocket)
      workerSocket.once("open", () => {
        proxyWebSockets({
          bufferBytes,
          closeTimeoutMilliseconds: 25,
          messageBytes,
          publicSocket,
          reservation: lease,
          workerSocket,
        })
        publicSocket.send("ready")
      })
    })
    const client = await openedAndReady(publicServer.url)
    const closed = nextClose(client)

    // When
    client.send("12345")

    // Then
    expect(await closed).toMatchObject({ code: 1009 })
    await expect.poll(() => ledger.snapshot().activeCount).toBe(0)
  })
})
