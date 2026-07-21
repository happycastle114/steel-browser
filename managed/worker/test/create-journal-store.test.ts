import { randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  CREATE_JOURNAL_STATE,
  JOURNAL_ACCEPT_RESULT,
  PUBLIC_URL_KIND,
  type CreateReplay,
  type ManagedCreateContext,
} from "../src/create-journal-contract.js"
import {
  CreateJournalStore,
  type CreateJournalLimits,
} from "../src/create-journal-store.js"
import type { CreateJournalPersistence } from "../src/create-journal-persistence.js"
import { buildCreateReplay } from "../src/create-replay-template.js"

const roots: string[] = []
const SESSION_ID = "77c0575c-2513-4db5-a80e-8e2675041fcb"
const limits: CreateJournalLimits = { maxRecords: 2, recordBytes: 32_768, ttlMs: 100 }

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

function context(seed: string): ManagedCreateContext {
  const ownerSha256 = seed.repeat(64).slice(0, 64)
  const requestSha256 = (seed === "a" ? "b" : "a").repeat(64)
  return {
    managerInstanceId: randomUUID(),
    ownerDigest: Buffer.from(ownerSha256, "hex"),
    ownerSha256,
    poolId: "managed-blue",
    requestDigest: Buffer.from(requestSha256, "hex"),
    requestSha256,
    token: `h1_${seed.repeat(64).slice(0, 64)}`,
  }
}

const replay: CreateReplay = {
  bodyTemplate: { error: "fixture" },
  headers: { contentType: "application/json" },
  status: 400,
}

async function store(clock = { now: () => 1_000 }): Promise<{
  readonly file: string
  readonly journal: CreateJournalStore
}> {
  const root = await mkdtemp(join(tmpdir(), "steel-create-journal-"))
  roots.push(root)
  const file = join(root, "journal.json")
  const journal = new CreateJournalStore(file, clock, limits)
  await journal.initialize()
  return { file, journal }
}

describe("durable create journal", () => {
  it("atomically persists ACCEPTED before an upstream transition", async () => {
    const fixture = await store()
    const accepted = await fixture.journal.accept(context("a"))
    const persisted: unknown = JSON.parse(await readFile(fixture.file, "utf8"))

    expect(accepted.kind).toBe(JOURNAL_ACCEPT_RESULT.ACCEPTED)
    expect(persisted).toMatchObject([{ state: CREATE_JOURNAL_STATE.ACCEPTED }])
  })

  it("starts every boot with an empty journal file", async () => {
    const fixture = await store()
    await fixture.journal.accept(context("a"))

    await fixture.journal.initialize()

    expect(JSON.parse(await readFile(fixture.file, "utf8"))).toEqual([])
    expect(await fixture.journal.active()).toEqual([])
  })

  it("persists URL placeholders without binding the candidate public origin", async () => {
    const fixture = await store()
    const input = context("a")
    const candidateOrigin = "https://steel-candidate.soungmin.tech"
    const candidateWebSocketOrigin = "wss://steel-candidate.soungmin.tech"
    const responseBody = Buffer.from(JSON.stringify({
      debugUrl: `${candidateOrigin}/v1/sessions/debug`,
      debuggerUrl: `${candidateOrigin}/v1/devtools/inspector.html`,
      id: SESSION_ID,
      sessionViewerUrl: `${candidateOrigin}/`,
      websocketUrl: `${candidateWebSocketOrigin}/`,
    }))
    const represented = buildCreateReplay(
      200,
      { "content-type": "application/json" },
      responseBody,
    )
    await fixture.journal.accept(input)
    await fixture.journal.markPending(input.token)
    await fixture.journal.complete(
      input.token,
      CREATE_JOURNAL_STATE.LIVE,
      represented.replay,
      represented.sessionId,
    )

    const persisted = await readFile(fixture.file, "utf8")
    expect(persisted).not.toContain(candidateOrigin)
    expect(persisted).not.toContain(candidateWebSocketOrigin)
    expect(JSON.parse(persisted)).toMatchObject([{
      replay: {
        bodyTemplate: {
          websocketUrl: {
            sessionId: SESSION_ID,
            urlKind: PUBLIC_URL_KIND.WEBSOCKET,
          },
        },
        headers: { contentType: "application/json" },
      },
    }])
    expect(JSON.parse(persisted)[0].replay.headers).not.toHaveProperty(
      "contentLength",
    )
  })

  it("does not publish an in-memory ACCEPTED record when persistence fails", async () => {
    let writes = 0
    const persistence: CreateJournalPersistence = {
      write: async () => {
        writes += 1
        if (writes === 2) throw new Error("fixture persistence failure")
      },
    }
    const journal = new CreateJournalStore(
      "unused",
      { now: () => 1_000 },
      limits,
      persistence,
    )
    await journal.initialize()
    const input = context("a")

    await expect(journal.accept(input)).rejects.toThrow("persistence failure")
    expect(await journal.lookup(input.token)).toBeUndefined()
  })

  it("retains ACCEPTED when the durable pending transition fails", async () => {
    let writes = 0
    const persistence: CreateJournalPersistence = {
      write: async () => {
        writes += 1
        if (writes === 3) throw new Error("fixture persistence failure")
      },
    }
    const journal = new CreateJournalStore(
      "unused",
      { now: () => 1_000 },
      limits,
      persistence,
    )
    await journal.initialize()
    const input = context("a")
    await journal.accept(input)

    await expect(journal.markPending(input.token)).rejects.toThrow(
      "persistence failure",
    )
    expect((await journal.lookup(input.token))?.state).toBe(
      CREATE_JOURNAL_STATE.ACCEPTED,
    )
  })

  it("returns the same record for matching raw digests and conflicts on mismatch", async () => {
    const fixture = await store()
    const first = context("a")
    await fixture.journal.accept(first)

    expect((await fixture.journal.accept(first)).kind).toBe(JOURNAL_ACCEPT_RESULT.DUPLICATE)
    expect((await fixture.journal.accept({ ...context("b"), token: first.token })).kind).toBe(
      JOURNAL_ACCEPT_RESULT.CONFLICT,
    )
  })

  it("never evicts an active create to admit another token", async () => {
    const fixture = await store()
    const first = context("a")
    await fixture.journal.accept(first)

    expect((await fixture.journal.accept(context("b"))).kind).toBe(
      JOURNAL_ACCEPT_RESULT.WORKER_BUSY,
    )
    expect((await fixture.journal.lookup(first.token))?.state).toBe(
      CREATE_JOURNAL_STATE.ACCEPTED,
    )
  })

  it("terminalizes LIVE only after a reconciled idle observation", async () => {
    const fixture = await store()
    const input = context("a")
    await fixture.journal.accept(input)
    await fixture.journal.markPending(input.token)
    await fixture.journal.complete(
      input.token,
      CREATE_JOURNAL_STATE.LIVE,
      { ...replay, status: 200 },
      randomUUID(),
    )

    expect((await fixture.journal.lookup(input.token))?.state).toBe(CREATE_JOURNAL_STATE.LIVE)
    await fixture.journal.reconcileIdle()
    expect((await fixture.journal.lookup(input.token))?.state).toBe(
      CREATE_JOURNAL_STATE.RELEASED_TERMINAL,
    )
  })

  it("evicts oldest terminal records but never an active record", async () => {
    let now = 1_000
    const fixture = await store({ now: () => now })
    for (const seed of ["a", "b"] as const) {
      const input = context(seed)
      await fixture.journal.accept(input)
      await fixture.journal.markPending(input.token)
      await fixture.journal.complete(input.token, CREATE_JOURNAL_STATE.FAILED_TERMINAL, replay)
      now += 1
    }
    const third = context("c")
    expect((await fixture.journal.accept(third)).kind).toBe(JOURNAL_ACCEPT_RESULT.ACCEPTED)
    expect(await fixture.journal.lookup(context("a").token)).toBeUndefined()
    expect((await fixture.journal.lookup(third.token))?.state).toBe(CREATE_JOURNAL_STATE.ACCEPTED)
  })

  it("starts terminal retention at the terminal transition time", async () => {
    let now = 1_000
    const fixture = await store({ now: () => now })
    const input = context("a")
    await fixture.journal.accept(input)
    await fixture.journal.markPending(input.token)

    now = 1_050
    await fixture.journal.complete(
      input.token,
      CREATE_JOURNAL_STATE.FAILED_TERMINAL,
      replay,
    )

    expect(await fixture.journal.lookup(input.token)).toMatchObject({
      expiresAt: new Date(1_150).toISOString(),
      state: CREATE_JOURNAL_STATE.FAILED_TERMINAL,
    })
  })

  it("quarantines a response that exceeds the reserved record bound", async () => {
    const fixture = await store()
    const constrained = new CreateJournalStore(
      fixture.file,
      { now: () => 1_000 },
      { ...limits, recordBytes: 400 },
    )
    await constrained.initialize()
    const input = context("a")
    await constrained.accept(input)
    await constrained.markPending(input.token)
    const completed = await constrained.complete(
      input.token,
      CREATE_JOURNAL_STATE.FAILED_TERMINAL,
      { ...replay, bodyTemplate: { error: "x".repeat(1_000) } },
    )

    expect(completed).toBe(false)
    expect((await constrained.lookup(input.token))?.state).toBe(CREATE_JOURNAL_STATE.UNCERTAIN)
  })

  it("quarantines an interrupted create without exposing correlation or replay", async () => {
    const fixture = await store()
    const input = context("a")
    await fixture.journal.accept(input)
    await fixture.journal.markPending(input.token)

    await fixture.journal.reconcileActiveSession(SESSION_ID)

    expect(await fixture.journal.lookup(input.token)).toMatchObject({
      state: CREATE_JOURNAL_STATE.UNCERTAIN,
    })
    expect(await fixture.journal.lookup(input.token)).not.toHaveProperty(
      "upstreamSessionId",
    )
    expect(await fixture.journal.lookup(input.token)).not.toHaveProperty("replay")
    expect(JSON.stringify(await fixture.journal.lookup(input.token))).not.toContain(
      "http://",
    )
  })
})
