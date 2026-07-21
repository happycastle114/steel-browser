import { afterEach, describe, expect, it } from "vitest"
import WebSocket, { WebSocketServer } from "ws"
import {
  WEB_SOCKET_FIXED_OVERHEAD_BYTES,
  WebSocketReservationLedger,
  proxyWebSockets,
  type WebSocketDuplexController,
} from "../src/websocket/duplex-proxy.js"

const servers: WebSocketServer[] = []
const sockets: WebSocket[] = []

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate()
  await Promise.all(servers.splice(0).map(async (server) => new Promise<void>((resolve) => {
    server.close(() => resolve())
  })))
})

type ProxiedPair = {
  readonly client: WebSocket
  readonly controller: WebSocketDuplexController
  readonly ledger: WebSocketReservationLedger
  readonly workerPeer: WebSocket
}

async function proxiedPair(
  options = { bufferBytes: 16, messageBytes: 4 },
): Promise<ProxiedPair> {
  let acceptWorker: ((socket: WebSocket) => void) | undefined
  const acceptedWorker = new Promise<WebSocket>((resolve) => {
    acceptWorker = resolve
  })
  const workerServer = new WebSocketServer({ host: "127.0.0.1", port: 0 })
  servers.push(workerServer)
  workerServer.on("connection", (socket) => {
    sockets.push(socket)
    acceptWorker?.(socket)
  })
  const workerUrl = await listeningUrl(workerServer)
  const ledger = new WebSocketReservationLedger({
    bufferBytes: options.bufferBytes,
    limitBytes: WEB_SOCKET_FIXED_OVERHEAD_BYTES + (2 * options.bufferBytes) + (2 * options.messageBytes),
    limitCount: 1,
    messageBytes: options.messageBytes,
  })
  let acceptController: ((controller: WebSocketDuplexController) => void) | undefined
  const acceptedController = new Promise<WebSocketDuplexController>((resolve) => {
    acceptController = resolve
  })
  const publicServer = new WebSocketServer({ host: "127.0.0.1", port: 0 })
  servers.push(publicServer)
  publicServer.on("connection", (publicSocket) => {
    sockets.push(publicSocket)
    const workerSocket = new WebSocket(workerUrl)
    sockets.push(workerSocket)
    workerSocket.once("open", () => {
      const reservation = ledger.tryReserve()
      if (reservation === undefined) throw new TypeError("expected websocket capacity")
      const controller = proxyWebSockets({
        bufferBytes: options.bufferBytes,
        closeTimeoutMilliseconds: 25,
        messageBytes: options.messageBytes,
        publicSocket,
        reservation,
        workerSocket,
      })
      acceptController?.(controller)
      publicSocket.send("ready")
    })
  })
  const client = await readyClient(await listeningUrl(publicServer))
  sockets.push(client)
  return {
    client,
    controller: await acceptedController,
    ledger,
    workerPeer: await acceptedWorker,
  }
}

function listeningUrl(server: WebSocketServer): Promise<string> {
  return new Promise((resolve) => {
    const ready = () => {
      const address = server.address()
      if (address === null || typeof address === "string") {
        throw new TypeError("expected websocket TCP address")
      }
      resolve(`ws://127.0.0.1:${address.port}`)
    }
    if (server.address() === null) server.once("listening", ready)
    else ready()
  })
}

function readyClient(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.once("message", (data) => {
      if (data.toString() === "ready") resolve(socket)
      else reject(new TypeError("expected websocket readiness marker"))
    })
    socket.once("error", reject)
  })
}

function closeResult(socket: WebSocket): Promise<{ readonly code: number; readonly reason: string }> {
  return new Promise((resolve) => socket.once("close", (code, reason) => resolve({
    code,
    reason: reason.toString("utf8"),
  })))
}

describe("WebSocket public close policy", () => {
  it("maps a private worker application close to a fixed redacted failure", async () => {
    // Given
    const pair = await proxiedPair()
    const closed = closeResult(pair.client)

    // When
    pair.workerPeer.close(4001, "private worker-00:3000 token=secret")

    // Then
    expect(await closed).toEqual({ code: 1011, reason: "worker websocket failed" })
    await expect.poll(() => pair.ledger.snapshot().activeCount).toBe(0)
  })

  it("preserves the corpus-approved worker 1000 code without forwarding its reason", async () => {
    // Given
    const pair = await proxiedPair()
    const closed = closeResult(pair.client)

    // When
    pair.workerPeer.close(1000, "private-token")

    // Then
    expect(await closed).toEqual({ code: 1000, reason: "" })
  })

  it("reports an abrupt public transport loss truthfully to the worker", async () => {
    // Given
    const pair = await proxiedPair()
    const workerClosed = closeResult(pair.workerPeer)

    // When
    pair.client.terminate()

    // Then
    expect(await workerClosed).toEqual({ code: 1006, reason: "" })
  })

  it("awaits socket closure and reservation release during shutdown", async () => {
    // Given
    const pair = await proxiedPair()

    // When
    await pair.controller.shutdown()

    // Then
    expect(pair.client.readyState).toBe(WebSocket.CLOSED)
    expect(pair.workerPeer.readyState).toBe(WebSocket.CLOSED)
    expect(pair.ledger.snapshot().activeCount).toBe(0)
  })

  it("bounds queued zero-byte frames by count", async () => {
    // Given
    const pair = await proxiedPair()
    const closed = closeResult(pair.client)

    // When
    for (let index = 0; index < 100; index += 1) pair.client.send(Buffer.alloc(0))

    // Then
    expect(await closed).toEqual({
      code: 1009,
      reason: "websocket message exceeded capacity",
    })
    await expect.poll(() => pair.ledger.snapshot().activeCount).toBe(0)
  })

  it("fails a paused worker consumer within the admitted queue bound", async () => {
    // Given
    const pair = await proxiedPair({ bufferBytes: 128, messageBytes: 4 })
    pair.workerPeer.pause()
    const closed = closeResult(pair.client)

    // When
    for (let index = 0; index < 1_000; index += 1) pair.client.send("1234")

    // Then
    expect(await closed).toEqual({
      code: 1009,
      reason: "websocket message exceeded capacity",
    })
    await expect.poll(() => pair.ledger.snapshot().activeCount).toBe(0)
  })

  it("accounts and releases simultaneous bidirectional queue pressure", async () => {
    // Given
    const pair = await proxiedPair({ bufferBytes: 128, messageBytes: 4 })
    expect(pair.ledger.snapshot().reservationBytes).toBe(1_048_840)
    pair.client.pause()
    pair.workerPeer.pause()
    const closed = closeResult(pair.client)

    // When
    for (let index = 0; index < 1_000; index += 1) {
      pair.client.send("1234")
      pair.workerPeer.send("5678")
    }
    pair.client.resume()
    pair.workerPeer.resume()

    // Then
    expect(await closed).toEqual({
      code: 1009,
      reason: "websocket message exceeded capacity",
    })
    await expect.poll(() => pair.ledger.snapshot()).toMatchObject({
      activeCount: 0,
      reservedBytes: 0,
    })
  })

  it("maps abrupt worker death to the fixed public failure without changing affinity", async () => {
    // Given
    const pair = await proxiedPair()
    const closed = closeResult(pair.client)

    // When
    pair.workerPeer.terminate()

    // Then
    expect(await closed).toEqual({ code: 1011, reason: "worker websocket failed" })
    await expect.poll(() => pair.ledger.snapshot().activeCount).toBe(0)
  })
})
