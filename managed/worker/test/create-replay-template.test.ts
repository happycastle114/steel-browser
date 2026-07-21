import { describe, expect, it } from "vitest"
import { PUBLIC_URL_KIND } from "../src/create-journal-contract.js"
import { buildCreateReplay } from "../src/create-replay-template.js"

const SESSION_ID = "77c0575c-2513-4db5-a80e-8e2675041fcb"

type ReplayOrigins = {
  readonly http: string
  readonly websocket: string
}

const LOOPBACK_ORIGINS: ReplayOrigins = {
  http: "http://127.0.0.1:3001",
  websocket: "ws://127.0.0.1:3001",
}

function createBody(
  extra: Record<string, unknown> = {},
  origins: ReplayOrigins = LOOPBACK_ORIGINS,
): Buffer {
  return Buffer.from(JSON.stringify({
    createdAt: "2026-07-21T08:00:00.000Z",
    debugUrl: `${origins.http}/v1/sessions/debug`,
    debuggerUrl: `${origins.http}/v1/devtools/inspector.html`,
    id: SESSION_ID,
    sessionViewerUrl: `${origins.http}/`,
    status: "live",
    unknownAdditive: { enabled: true },
    websocketUrl: `${origins.websocket}/`,
    ...extra,
  }))
}

describe("create replay templates", () => {
  it("preserves additive JSON and replaces only committed URL pointers", () => {
    const body = createBody()
    const represented = buildCreateReplay(
      200,
      {
        "content-length": String(body.byteLength),
        "content-type": "application/json; charset=utf-8",
        location: "ws://127.0.0.1:3001/",
        "set-cookie": ["secret=blocked"],
      },
      body,
    )

    expect(represented.sessionId).toBe(SESSION_ID)
    expect(represented.replay.headers).toEqual({
      contentType: "application/json; charset=utf-8",
      locationTemplate: {
        kind: "PUBLIC_URL",
        sessionId: SESSION_ID,
        urlKind: PUBLIC_URL_KIND.WEBSOCKET,
      },
    })
    expect(represented.replay.bodyTemplate).toMatchObject({
      unknownAdditive: { enabled: true },
      websocketUrl: {
        kind: "PUBLIC_URL",
        sessionId: SESSION_ID,
        urlKind: PUBLIC_URL_KIND.WEBSOCKET,
      },
    })
    expect(JSON.stringify(represented.replay)).not.toContain("127.0.0.1")
    expect(JSON.stringify(represented.replay)).not.toContain("secret")
  })

  it("builds the same origin-neutral replay across candidate and production hosts", () => {
    const candidateOrigins: ReplayOrigins = {
      http: "https://steel-candidate.soungmin.tech",
      websocket: "wss://steel-candidate.soungmin.tech",
    }
    const productionOrigins: ReplayOrigins = {
      http: "https://steel.soungmin.tech",
      websocket: "wss://steel.soungmin.tech",
    }
    const candidate = buildCreateReplay(
      200,
      { "content-type": "application/json" },
      createBody({}, candidateOrigins),
    )
    const production = buildCreateReplay(
      200,
      { "content-type": "application/json" },
      createBody({}, productionOrigins),
    )

    expect(candidate).toEqual(production)
    const serialized = JSON.stringify(candidate)
    expect(serialized).not.toContain(candidateOrigins.http)
    expect(serialized).not.toContain(candidateOrigins.websocket)
    expect(serialized).not.toContain(productionOrigins.http)
    expect(serialized).not.toContain(productionOrigins.websocket)
  })

  it.each([
    ["private URL outside allowlist", createBody({ extraUrl: "http://127.0.0.1/private" })],
    ["credential URL", createBody({ websocketUrl: "ws://user:secret@example.com/" })],
    ["wrong URL protocol", createBody({ websocketUrl: "https://example.com/" })],
    ["non JSON", Buffer.from("not-json")],
  ])("rejects %s", (_name, body) => {
    expect(() =>
      buildCreateReplay(200, { "content-type": "application/json" }, body),
    ).toThrow()
  })

  it("represents a bounded failure without inventing a session", () => {
    const body = Buffer.from(JSON.stringify({ error: "invalid" }))
    expect(
      buildCreateReplay(400, { "content-type": "application/json" }, body),
    ).toMatchObject({ replay: { bodyTemplate: { error: "invalid" }, status: 400 } })
  })
})
