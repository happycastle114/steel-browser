import { randomUUID } from "node:crypto"
import { createServer, request, type RequestListener, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  CREATE_JOURNAL_STATE,
  MANAGED_CREATE_HEADER,
  type ManagedCreateContext,
} from "../src/create-journal-contract.js"
import { CreateJournalStore } from "../src/create-journal-store.js"
import type { CreateJournalPersistence } from "../src/create-journal-persistence.js"
import {
  WORKER_ACTIVE_CREATES_PATH,
  parseWorkerConfig,
} from "../src/config.js"
import { createSupervisorProxy } from "../src/supervisor-proxy.js"
import type { SupervisorProxyConfig } from "../src/supervisor-transport.js"

const INSTANCE_ID = "11223344-5566-4788-99aa-bbccddeeff00"
const SESSION_ID = "77c0575c-2513-4db5-a80e-8e2675041fcb"
const TOKEN = `h1_${"a".repeat(64)}`
const roots: string[] = []
const servers: Server[] = []

type Result = {
  readonly body: Buffer
  readonly headers: NodeJS.Dict<string | string[]>
  readonly status: number | undefined
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve())
  })))
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

function address(server: Server): AddressInfo {
  const value = server.address()
  if (value === null || typeof value === "string") throw new TypeError("server is not bound")
  return value
}

function managedHeaders(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    [MANAGED_CREATE_HEADER.MANAGER_INSTANCE_ID]: randomUUID(),
    [MANAGED_CREATE_HEADER.OWNER_SHA256]: "b".repeat(64),
    [MANAGED_CREATE_HEADER.POOL_ID]: "managed-blue",
    [MANAGED_CREATE_HEADER.REQUEST_SHA256]: "c".repeat(64),
    [MANAGED_CREATE_HEADER.TOKEN]: TOKEN,
    "content-type": "application/json",
    ...overrides,
  }
}

function managedContext(): ManagedCreateContext {
  const ownerSha256 = "b".repeat(64)
  const requestSha256 = "c".repeat(64)
  return {
    managerInstanceId: randomUUID(),
    ownerDigest: Buffer.from(ownerSha256, "hex"),
    ownerSha256,
    poolId: "managed-blue",
    requestDigest: Buffer.from(requestSha256, "hex"),
    requestSha256,
    token: TOKEN,
  }
}

function send(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body = Buffer.alloc(0),
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const outgoing = request({ headers, host: "127.0.0.1", method, path, port }, (response) => {
      const chunks: Buffer[] = []
      response.on("data", (chunk: Buffer) => chunks.push(chunk))
      response.on("end", () => resolve({ body: Buffer.concat(chunks), headers: response.headers, status: response.statusCode }))
    })
    outgoing.on("error", reject)
    outgoing.end(body)
  })
}

async function fixture(
  handler: RequestListener,
  prepare?: (journal: CreateJournalStore) => Promise<void>,
  createJournal: (file: string) => CreateJournalStore = (file) =>
    new CreateJournalStore(file),
): Promise<{ readonly journal: CreateJournalStore; readonly port: number }> {
  const upstream = createServer(handler)
  servers.push(upstream)
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve))
  const root = await mkdtemp(join(tmpdir(), "steel-journal-http-"))
  roots.push(root)
  const journal = createJournal(join(root, "journal.json"))
  await journal.initialize()
  await prepare?.(journal)
  const config: SupervisorProxyConfig = {
    browserVersion: "140.0.7339.16",
    instanceId: INSTANCE_ID,
    upstream: address(upstream),
    upstreamSha: "d".repeat(40),
    workerId: parseWorkerConfig({ MANAGED_WORKER_ID: "worker-00" }).workerId,
  }
  const supervisor = createSupervisorProxy(config, journal)
  servers.push(supervisor)
  await new Promise<void>((resolve) => supervisor.listen(0, "127.0.0.1", resolve))
  return { journal, port: address(supervisor).port }
}

async function waitForState(
  journal: CreateJournalStore,
  state: (typeof CREATE_JOURNAL_STATE)[keyof typeof CREATE_JOURNAL_STATE],
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await journal.lookup(TOKEN))?.state === state) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`journal did not reach ${state}`)
}

function upstreamBody(extra: Record<string, unknown> = {}): Buffer {
  return Buffer.from(JSON.stringify({
    debugUrl: "http://127.0.0.1:3001/v1/sessions/debug",
    debuggerUrl: "http://127.0.0.1:3001/v1/devtools/inspector.html",
    id: SESSION_ID,
    sessionViewerUrl: "http://127.0.0.1:3001/",
    status: "live",
    unknownAdditive: { retained: true },
    websocketUrl: "ws://127.0.0.1:3001/",
    ...extra,
  }))
}

function idleInventoryBody(): string {
  return JSON.stringify({ sessions: [{ id: randomUUID(), status: "idle" }] })
}

describe("journal-aware private create transport", () => {
  it("persists, forwards once, enumerates, looks up and detects digest conflicts", async () => {
    let upstreamCreates = 0
    const expected = upstreamBody()
    const app = await fixture((incoming, response) => {
      if (incoming.method === "POST") {
        upstreamCreates += 1
        expect(incoming.headers[MANAGED_CREATE_HEADER.TOKEN]).toBeUndefined()
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" }).end(expected)
        return
      }
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({ sessions: [{ id: SESSION_ID, status: "live" }] }),
      )
    })

    const created = await send(app.port, "POST", "/v1/sessions", managedHeaders(), Buffer.from("{}"))
    expect(created.status).toBe(200)
    expect(created.body).toEqual(expected)
    await waitForState(app.journal, CREATE_JOURNAL_STATE.LIVE)

    const active = await send(app.port, "GET", WORKER_ACTIVE_CREATES_PATH)
    expect(JSON.parse(active.body.toString())).toMatchObject({
      creates: [{ token: TOKEN, state: CREATE_JOURNAL_STATE.LIVE }],
    })
    const lookup = await send(app.port, "GET", `/v1/managed-worker/creates/${TOKEN}`)
    expect(JSON.parse(lookup.body.toString())).toMatchObject({
      replay: { bodyTemplate: { unknownAdditive: { retained: true }, websocketUrl: { kind: "PUBLIC_URL" } } },
      state: CREATE_JOURNAL_STATE.LIVE,
      upstreamSessionId: SESSION_ID,
    })

    const duplicate = await send(app.port, "POST", "/v1/sessions", managedHeaders(), Buffer.from("{}"))
    expect(duplicate.status).toBe(200)
    expect(JSON.parse(duplicate.body.toString())).toMatchObject({
      state: CREATE_JOURNAL_STATE.LIVE,
      token: TOKEN,
    })
    const conflict = await send(
      app.port,
      "POST",
      "/v1/sessions",
      managedHeaders({ [MANAGED_CREATE_HEADER.OWNER_SHA256]: "e".repeat(64) }),
      Buffer.from("{}"),
    )
    expect(conflict.status).toBe(409)
    expect(upstreamCreates).toBe(1)
  })

  it("continues the upstream create after the manager disconnects", async () => {
    const app = await fixture((_incoming, response) => {
      setTimeout(() => response.writeHead(200, { "content-type": "application/json" }).end(upstreamBody()), 30)
    })

    await new Promise<void>((resolve) => {
      const outgoing = request({
        headers: managedHeaders(), host: "127.0.0.1", method: "POST", path: "/v1/sessions", port: app.port,
      })
      outgoing.on("error", () => resolve())
      outgoing.end("{}", () => {
        setTimeout(() => {
          outgoing.destroy()
          resolve()
        }, 5)
      })
    })

    await waitForState(app.journal, CREATE_JOURNAL_STATE.LIVE)
  })

  it("resumes a durably ACCEPTED create after a pending-write failure retry", async () => {
    let upstreamCreates = 0
    const app = await fixture(
      (_incoming, response) => {
        upstreamCreates += 1
        response.writeHead(200, { "content-type": "application/json" }).end(
          upstreamBody(),
        )
      },
      async (journal) => {
        await journal.accept(managedContext())
      },
    )

    const retried = await send(
      app.port,
      "POST",
      "/v1/sessions",
      managedHeaders(),
      Buffer.from("{}"),
    )

    expect(retried.status).toBe(200)
    await waitForState(app.journal, CREATE_JOURNAL_STATE.LIVE)
    expect(upstreamCreates).toBe(1)
  })

  it("quarantines an unsafe additive URL and terminalizes release only after idle reconciliation", async () => {
    let unsafe = true
    const app = await fixture((incoming, response) => {
      if (incoming.method === "POST") {
        response.writeHead(200, { "content-type": "application/json" }).end(
          unsafe ? upstreamBody({ privateUrl: "http://127.0.0.1/secret" }) : upstreamBody(),
        )
        return
      }
      response.writeHead(200, { "content-type": "application/json" }).end(idleInventoryBody())
    })
    await send(app.port, "POST", "/v1/sessions", managedHeaders(), Buffer.from("{}"))
    await waitForState(app.journal, CREATE_JOURNAL_STATE.UNCERTAIN)

    unsafe = false
    const secondHeaders = managedHeaders({
      [MANAGED_CREATE_HEADER.TOKEN]: `h1_${"f".repeat(64)}`,
    })
    const second = await send(app.port, "POST", "/v1/sessions", secondHeaders, Buffer.from("{}"))
    expect(second.status).toBe(503)

    const isolated = await fixture((incoming, response) => {
      response.writeHead(200, { "content-type": "application/json" }).end(
        incoming.method === "POST" ? upstreamBody() : idleInventoryBody(),
      )
    })
    await send(isolated.port, "POST", "/v1/sessions", managedHeaders(), Buffer.from("{}"))
    await waitForState(isolated.journal, CREATE_JOURNAL_STATE.LIVE)
    await send(isolated.port, "GET", WORKER_ACTIVE_CREATES_PATH)
    await waitForState(isolated.journal, CREATE_JOURNAL_STATE.RELEASED_TERMINAL)
  })

  it("quarantines a failed response that still claims a created session", async () => {
    const app = await fixture((_incoming, response) => {
      response.writeHead(400, { "content-type": "application/json" }).end(
        upstreamBody(),
      )
    })

    const result = await send(
      app.port,
      "POST",
      "/v1/sessions",
      managedHeaders(),
      Buffer.from("{}"),
    )

    expect(result.status).toBe(400)
    await waitForState(app.journal, CREATE_JOURNAL_STATE.UNCERTAIN)
    const record = await app.journal.lookup(TOKEN)
    expect(record).not.toHaveProperty("replay")
    expect(record).not.toHaveProperty("upstreamSessionId")
    expect(JSON.stringify(record)).not.toContain(SESSION_ID)
  })

  it("rejects partial internal headers before contacting upstream", async () => {
    let upstreamCalls = 0
    const app = await fixture((_incoming, response) => {
      upstreamCalls += 1
      response.writeHead(500).end()
    })
    const result = await send(app.port, "POST", "/v1/sessions", {
      [MANAGED_CREATE_HEADER.TOKEN]: TOKEN,
    }, Buffer.from("{}"))

    expect(result.status).toBe(400)
    expect(upstreamCalls).toBe(0)

    const unknown = await send(
      app.port,
      "POST",
      "/v1/sessions",
      managedHeaders({ "x-managed-unknown": "blocked" }),
      Buffer.from("{}"),
    )
    expect(unknown.status).toBe(400)
    expect(upstreamCalls).toBe(0)
  })

  it("fails active enumeration closed when loopback reconciliation is unavailable", async () => {
    const app = await fixture((_incoming, response) => {
      response.writeHead(500, { "content-type": "application/json" }).end("{}")
    })

    const result = await send(app.port, "GET", WORKER_ACTIVE_CREATES_PATH)

    expect(result.status).toBe(503)
    expect(JSON.parse(result.body.toString())).toEqual({
      code: "UPSTREAM_OBSERVATION_UNAVAILABLE",
    })
  })

  it("fails active enumeration closed when a durable release transition fails", async () => {
    const persistence: CreateJournalPersistence = {
      write: async (records) => {
        if (
          records.some(
            (record) =>
              record.state === CREATE_JOURNAL_STATE.RELEASED_TERMINAL,
          )
        ) {
          throw new Error("fixture persistence failure")
        }
      },
    }
    const app = await fixture(
      (incoming, response) => {
        response.writeHead(200, { "content-type": "application/json" }).end(
          incoming.method === "POST" ? upstreamBody() : idleInventoryBody(),
        )
      },
      undefined,
      (file) =>
        new CreateJournalStore(
          file,
          undefined,
          undefined,
          persistence,
        ),
    )
    await send(app.port, "POST", "/v1/sessions", managedHeaders(), Buffer.from("{}"))
    await waitForState(app.journal, CREATE_JOURNAL_STATE.LIVE)

    const result = await send(app.port, "GET", WORKER_ACTIVE_CREATES_PATH)

    expect(result.status).toBe(503)
    expect((await app.journal.lookup(TOKEN))?.state).toBe(
      CREATE_JOURNAL_STATE.LIVE,
    )
  })

  it("rejects an oversized create body without contacting upstream", async () => {
    let upstreamCalls = 0
    const app = await fixture((_incoming, response) => {
      upstreamCalls += 1
      response.writeHead(500).end()
    })

    const result = await send(
      app.port,
      "POST",
      "/v1/sessions",
      managedHeaders(),
      Buffer.alloc(2_097_153),
    )

    expect(result.status).toBe(400)
    expect(upstreamCalls).toBe(0)
  })
})
