import { createServer, type Server } from "node:http"
import { connect, type Socket } from "node:net"
import Fastify from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  installConnectionGuard,
  installIngressBodyGuard,
} from "../src/http/ingress-guard.js"
import {
  AtomicReservationLedger,
  ReservationLedgerKind,
} from "../src/memory/atomic-reservation-ledger.js"

describe("ingress guards", () => {
  const sockets: Socket[] = []
  const servers: Server[] = []

  afterEach(async () => {
    for (const socket of sockets) socket.destroy()
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve())
          }),
      ),
    )
  })

  it("reserves exact TCP accept capacity through socket close", async () => {
    // Given
    const ledger = new AtomicReservationLedger({
      kind: ReservationLedgerKind.INGRESS_CONNECTION,
      limitBytes: 100,
      limitCount: 1,
    })
    const rejected = vi.fn()
    const server = createServer((_request, response) => response.end())
    servers.push(server)
    installConnectionGuard(server, { ledger, onRejected: rejected, reservationBytes: 100 })
    await listen(server)
    const port = requirePort(server)

    // When
    const first = await openSocket(port)
    sockets.push(first)
    const second = await openSocket(port)
    sockets.push(second)
    await closed(second)

    // Then
    expect(ledger.snapshot()).toMatchObject({ reservedBytes: 100, reservedCount: 1 })
    expect(rejected).toHaveBeenCalledOnce()
    first.destroy()
    await closed(first)
    await vi.waitFor(() => {
      expect(ledger.snapshot()).toMatchObject({ reservedBytes: 0, reservedCount: 0 })
    })
  })

  it("holds a body reservation until the response finishes and rejects one-over", async () => {
    // Given
    const ledger = new AtomicReservationLedger({
      kind: ReservationLedgerKind.INGRESS_BODY,
      limitBytes: 1_000,
      limitCount: 1,
    })
    let finishFirst: (() => void) | undefined
    const firstPending = new Promise<void>((resolve) => {
      finishFirst = resolve
    })
    const app = Fastify()
    installIngressBodyGuard(app, {
      bodyLimitBytes: 100,
      bodyTimeoutMilliseconds: 2_000,
      ledger,
      reservationBytes: 1_000,
    })
    app.post("/work", async (request) => {
      if (request.body === "first") await firstPending
      return { ok: true }
    })

    // When
    const first = app.inject({
      headers: { "content-type": "text/plain" },
      method: "POST",
      payload: "first",
      url: "/work",
    })
    await vi.waitFor(() => expect(ledger.snapshot().reservedCount).toBe(1))
    const second = await app.inject({
      headers: { "content-type": "text/plain" },
      method: "POST",
      payload: "second",
      url: "/work",
    })

    // Then
    expect(second.statusCode).toBe(500)
    expect(ledger.snapshot().reservedCount).toBe(1)
    finishFirst?.()
    expect((await first).statusCode).toBe(200)
    await vi.waitFor(() => expect(ledger.snapshot().reservedCount).toBe(0))
    await app.close()
  })

  it("rejects declared oversize and encoded bodies before reservation", async () => {
    // Given
    const ledger = new AtomicReservationLedger({
      kind: ReservationLedgerKind.INGRESS_BODY,
      limitBytes: 1_000,
      limitCount: 1,
    })
    const app = Fastify()
    installIngressBodyGuard(app, {
      bodyLimitBytes: 4,
      bodyTimeoutMilliseconds: 2_000,
      ledger,
      reservationBytes: 1_000,
    })
    app.post("/work", async () => ({ ok: true }))

    // When
    const oversize = await app.inject({ method: "POST", payload: "12345", url: "/work" })
    const encoded = await app.inject({
      headers: { "content-encoding": "gzip" },
      method: "POST",
      payload: "1234",
      url: "/work",
    })

    // Then
    expect(oversize.statusCode).toBe(500)
    expect(encoded.statusCode).toBe(500)
    expect(ledger.snapshot()).toMatchObject({ reservedBytes: 0, reservedCount: 0 })
    await app.close()
  })
})

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
}

function requirePort(server: Server): number {
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("server address unavailable")
  return address.port
}

async function openSocket(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port })
    socket.once("connect", () => resolve(socket))
    socket.once("error", reject)
  })
}

async function closed(socket: Socket): Promise<void> {
  if (socket.closed) return
  await new Promise<void>((resolve) => socket.once("close", () => resolve()))
}
