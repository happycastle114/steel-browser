import { randomUUID } from "node:crypto"
import { createServer, get, request, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "vitest"
import {
  WORKER_IDENTITY_HEADER,
  WORKER_META_PATH,
  parseWorkerConfig,
} from "../src/config.js"
import { createSupervisorProxy } from "../src/supervisor-proxy.js"
import { CreateJournalStore } from "../src/create-journal-store.js"
import type { SupervisorProxyConfig } from "../src/supervisor-transport.js"

const INSTANCE_ID = "11223344-5566-4788-99aa-bbccddeeff00"
const WORKER_ID = parseWorkerConfig({
  MANAGED_WORKER_ID: "worker-00",
}).workerId

type HttpResult = {
  readonly body: Buffer
  readonly headers: Readonly<Record<string, string | string[] | undefined>>
  readonly statusCode: number | undefined
}

const servers: Server[] = []
const journalDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)))
        }),
    ),
  )
  await Promise.all(
    journalDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  )
})

async function createTestProxy(
  config: Omit<SupervisorProxyConfig, "browserVersion" | "upstreamSha">,
): Promise<Server> {
  const directory = join(tmpdir(), `steel-journal-${randomUUID()}`)
  journalDirectories.push(directory)
  const journal = new CreateJournalStore(join(directory, "journal.json"))
  await journal.initialize()
  return createSupervisorProxy(
    { ...config, browserVersion: "140.0.7339.16", upstreamSha: "a".repeat(40) },
    journal,
  )
}

function address(server: Server): AddressInfo {
  const bound = server.address()
  if (bound === null || typeof bound === "string") {
    throw new TypeError("expected an internet socket address")
  }
  return bound
}

function send(port: number, path: string, body?: Buffer): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        headers:
          body === undefined
            ? {
                "x-managed-forged": "blocked",
                "x-steel-managed-forged": "blocked",
              }
            : {
                "content-length": String(body.byteLength),
                "content-type": "application/octet-stream",
                "x-managed-forged": "blocked",
                "x-steel-managed-forged": "blocked",
              },
        host: "127.0.0.1",
        method: body === undefined ? "GET" : "POST",
        path,
        port,
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on("data", (chunk: Buffer) => chunks.push(chunk))
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks),
            headers: response.headers,
            statusCode: response.statusCode,
          })
        })
      },
    )
    outgoing.on("error", reject)
    if (body !== undefined) {
      outgoing.write(body)
    }
    outgoing.end()
  })
}

describe("production worker supervisor proxy", () => {
  it("streams upstream status headers and binary bytes without accepting forged internal headers", async () => {
    // Given
    const payload = Buffer.from([0, 1, 2, 3, 254, 255])
    const upstream = createServer((incoming, response) => {
      expect(incoming.headers["x-managed-forged"]).toBeUndefined()
      expect(incoming.headers["x-steel-managed-forged"]).toBeUndefined()
      response.writeHead(207, {
        "content-type": "application/octet-stream",
        "x-managed-forged": "blocked-response",
        "x-steel-managed-forged": "blocked-response",
        "x-upstream-additive": "preserved",
      })
      incoming.pipe(response)
    })
    servers.push(upstream)
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve))

    const supervisor = await createTestProxy({
      instanceId: INSTANCE_ID,
      upstream: address(upstream),
      workerId: WORKER_ID,
    })
    servers.push(supervisor)
    await new Promise<void>((resolve) => supervisor.listen(0, "127.0.0.1", resolve))

    // When
    const result = await send(address(supervisor).port, "/v1/screenshot", payload)

    // Then
    expect(result.statusCode).toBe(207)
    expect(result.body).toEqual(payload)
    expect(result.headers["x-upstream-additive"]).toBe("preserved")
    expect(result.headers["x-managed-forged"]).toBeUndefined()
    expect(result.headers["x-steel-managed-forged"]).toBeUndefined()
    expect(result.headers[WORKER_IDENTITY_HEADER.WORKER_ID.toLowerCase()]).toBe(
      WORKER_ID,
    )
    expect(result.headers[WORKER_IDENTITY_HEADER.INSTANCE_ID.toLowerCase()]).toBe(
      INSTANCE_ID,
    )
  })

  it("returns a trusted 502 contract when the upstream is unavailable", async () => {
    // Given
    const reservation = createServer()
    await new Promise<void>((resolve) =>
      reservation.listen(0, "127.0.0.1", resolve),
    )
    const unavailable = address(reservation)
    await new Promise<void>((resolve, reject) =>
      reservation.close((error) =>
        error === undefined ? resolve() : reject(error),
      ),
    )
    const supervisor = await createTestProxy({
      instanceId: INSTANCE_ID,
      upstream: unavailable,
      workerId: WORKER_ID,
    })
    servers.push(supervisor)
    await new Promise<void>((resolve) => supervisor.listen(0, "127.0.0.1", resolve))

    // When
    const result = await send(address(supervisor).port, "/v1/screenshot")

    // Then
    expect(result.statusCode).toBe(502)
    expect(JSON.parse(result.body.toString("utf8"))).toEqual({
      code: "WORKER_UPSTREAM_UNAVAILABLE",
    })
    expect(result.headers[WORKER_IDENTITY_HEADER.WORKER_ID.toLowerCase()]).toBe(
      WORKER_ID,
    )
    expect(result.headers[WORKER_IDENTITY_HEADER.INSTANCE_ID.toLowerCase()]).toBe(
      INSTANCE_ID,
    )
  })

  it("serves supervisor metadata without contacting upstream", async () => {
    // Given
    let upstreamRequests = 0
    const upstream = createServer((_incoming, response) => {
      upstreamRequests += 1
      response.writeHead(500).end()
    })
    servers.push(upstream)
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve))
    const supervisor = await createTestProxy({
      instanceId: INSTANCE_ID,
      upstream: address(upstream),
      workerId: WORKER_ID,
    })
    servers.push(supervisor)
    await new Promise<void>((resolve) => supervisor.listen(0, "127.0.0.1", resolve))

    // When
    const result = await send(address(supervisor).port, WORKER_META_PATH)

    // Then
    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body.toString("utf8"))).toEqual({
      browserVersion: "140.0.7339.16",
      instanceId: INSTANCE_ID,
      journalVersion: 1,
      upstreamSha: "a".repeat(40),
      workerId: WORKER_ID,
    })
    expect(upstreamRequests).toBe(0)
  })

  it("forwards websocket upgrades and bidirectional frames on the same private port", async () => {
    // Given
    const upstream = createServer()
    upstream.on("upgrade", (incoming, socket, head) => {
      expect(incoming.headers["x-managed-forged"]).toBeUndefined()
      expect(incoming.headers["x-steel-managed-forged"]).toBeUndefined()
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "X-Upstream-Additive: preserved\r\n" +
          "X-Managed-Forged: blocked-response\r\n" +
          "X-Steel-Managed-Forged: blocked-response\r\n\r\n",
      )
      if (head.byteLength > 0) {
        socket.write(head)
      }
      socket.pipe(socket)
    })
    servers.push(upstream)
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve))
    const supervisor = await createTestProxy({
      instanceId: INSTANCE_ID,
      upstream: address(upstream),
      workerId: WORKER_ID,
    })
    servers.push(supervisor)
    await new Promise<void>((resolve) => supervisor.listen(0, "127.0.0.1", resolve))

    // When
    const handshake = await new Promise<{
      readonly headers: Readonly<Record<string, string | string[] | undefined>>
      readonly echoed: Buffer
    }>((resolve, reject) => {
      const outgoing = get({
        headers: {
          connection: "Upgrade",
          upgrade: "websocket",
          "x-managed-forged": "blocked",
          "x-steel-managed-forged": "blocked",
        },
        host: "127.0.0.1",
        path: "/v1/ws?sessionId=fixture",
        port: address(supervisor).port,
      })
      outgoing.on("upgrade", (response, socket) => {
        const frame = Buffer.from("frame")
        socket.once("data", (echoed) => {
          resolve({ headers: response.headers, echoed })
          socket.destroy()
        })
        socket.write(frame)
      })
      outgoing.on("error", reject)
    })

    // Then
    expect(handshake.echoed).toEqual(Buffer.from("frame"))
    expect(handshake.headers["x-upstream-additive"]).toBe("preserved")
    expect(handshake.headers["x-managed-forged"]).toBeUndefined()
    expect(handshake.headers["x-steel-managed-forged"]).toBeUndefined()
    expect(handshake.headers[WORKER_IDENTITY_HEADER.WORKER_ID.toLowerCase()]).toBe(
      WORKER_ID,
    )
    expect(handshake.headers[WORKER_IDENTITY_HEADER.INSTANCE_ID.toLowerCase()]).toBe(
      INSTANCE_ID,
    )
  })

  it("closes the client websocket when the upgraded upstream socket errors", async () => {
    const upstream = createServer()
    upstream.on("upgrade", (_incoming, socket) => {
      socket.on("error", () => undefined)
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n\r\n",
      )
      setTimeout(() => socket.destroy(new Error("fixture upstream failure")), 5)
    })
    servers.push(upstream)
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve))
    const supervisor = await createTestProxy({
      instanceId: INSTANCE_ID,
      upstream: address(upstream),
      workerId: WORKER_ID,
    })
    servers.push(supervisor)
    await new Promise<void>((resolve) => supervisor.listen(0, "127.0.0.1", resolve))

    await expect(
      new Promise<void>((resolve, reject) => {
        const outgoing = get({
          headers: { connection: "Upgrade", upgrade: "websocket" },
          host: "127.0.0.1",
          path: "/v1/ws",
          port: address(supervisor).port,
        })
        outgoing.on("upgrade", (_response, socket) => {
          socket.on("close", () => resolve())
          socket.on("error", () => undefined)
        })
        outgoing.on("error", reject)
      }),
    ).resolves.toBeUndefined()
  })
})
