import { type AddressInfo } from "node:net"
import WebSocket, { WebSocketServer } from "ws"
import { z } from "zod"
import { afterEach, describe, expect, it } from "vitest"
import { CdpConnection } from "../src/ai/cdp-connection.js"

const RequestSchema = z.object({
  id: z.number().int().positive(),
  method: z.string().min(1),
  params: z.record(z.unknown()).optional(),
  sessionId: z.string().min(1).optional(),
}).strict()

const servers: WebSocketServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => new Promise<void>((resolve) => {
    for (const client of server.clients) client.terminate()
    server.close(() => resolve())
  })))
})

describe("CDP connection", () => {
  it("correlates a bounded command response over a real websocket", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 })
    servers.push(server)
    await new Promise<void>((resolve) => server.once("listening", resolve))
    server.on("connection", (socket) => socket.once("message", (raw) => {
      const request = RequestSchema.parse(JSON.parse(raw.toString()))
      socket.send(JSON.stringify({ id: request.id, result: { value: request.method } }))
    }))
    const socket = new WebSocket(`ws://127.0.0.1:${listenerPort(server.address())}`)
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve)
      socket.once("error", reject)
    })
    const connection = new CdpConnection({
      commandTimeoutMilliseconds: 1_000,
      messageBytes: 4_096,
      signal: new AbortController().signal,
      socket,
    })

    await expect(connection.send("Runtime.enable", {}, "page-session"))
      .resolves.toEqual({ value: "Runtime.enable" })
    await connection.close()
  })
})

function listenerPort(address: string | AddressInfo | null): number {
  if (address === null || typeof address === "string") throw new TypeError("listener address missing")
  return address.port
}
