import { describe, expect, it } from "vitest"

import { CreateReplaySchema } from "../src/create-replay-contract.js"
import { normalizeCreateReplay } from "../src/create-replay-normalization.js"
import { renderCreateReplay } from "../src/create-replay-renderer.js"
import { selectPublicOrigin } from "../src/public-urls.js"

const SESSION_ID = "77c0575c-2513-4db5-a80e-8e2675041fcb"
const CANDIDATE_HOST = "steel-candidate.soungmin.tech"
const PRODUCTION_HOST = "steel.soungmin.tech"

type ReplayOrigins = Readonly<{ http: string; websocket: string }>

function createBody(origins: ReplayOrigins): Record<string, unknown> {
  return {
    createdAt: "2026-07-21T08:00:00.000Z",
    debugUrl: `${origins.http}/v1/sessions/debug`,
    debuggerUrl: `${origins.http}/v1/devtools/inspector.html`,
    id: SESSION_ID,
    sessionViewerUrl: `${origins.http}/`,
    status: "live",
    websocketUrl: `${origins.websocket}/`,
  }
}

const candidateOrigins = {
  http: `https://${CANDIDATE_HOST}`,
  websocket: `wss://${CANDIDATE_HOST}`,
}
const productionOrigins = {
  http: `https://${PRODUCTION_HOST}`,
  websocket: `wss://${PRODUCTION_HOST}`,
}

describe("origin-neutral create replay", () => {
  it("normalizes candidate and production inputs to one identical persisted template", () => {
    // Given: byte-equivalent upstream responses whose only difference is the absolute origin.
    const candidate = normalizeCreateReplay({
      status: 200,
      contentType: "application/json",
      body: createBody(candidateOrigins),
      location: `${candidateOrigins.websocket}/`,
    })
    const production = normalizeCreateReplay({
      status: 200,
      contentType: "application/json",
      body: createBody(productionOrigins),
      location: `${productionOrigins.websocket}/`,
    })
    // When: both responses cross the persistence boundary.
    const serialized = JSON.stringify(candidate)
    // Then: one origin-free template represents both without a stale byte length.
    expect(candidate).toEqual(production)
    expect(serialized).not.toContain(CANDIDATE_HOST)
    expect(serialized).not.toContain(PRODUCTION_HOST)
    expect(serialized).not.toContain("contentLength")
  })

  it("renders each selected origin and recomputes its exact encoded byte length", () => {
    // Given: one persisted origin-neutral replay template.
    const normalized = normalizeCreateReplay({
      status: 200,
      contentType: "application/json",
      body: createBody(candidateOrigins),
      location: `${candidateOrigins.websocket}/`,
    })
    const candidateOrigin = selectPublicOrigin(CANDIDATE_HOST, {
      [CANDIDATE_HOST]: candidateOrigins.http,
    })
    const productionOrigin = selectPublicOrigin(PRODUCTION_HOST, {
      [PRODUCTION_HOST]: productionOrigins.http,
    })
    // When: the manager renders the same template for candidate and production.
    const candidate = renderCreateReplay(normalized.replay, candidateOrigin)
    const production = renderCreateReplay(normalized.replay, productionOrigin)
    // Then: each Content-Length is derived from its final rendered body bytes.
    expect(candidate.bodyJson).toContain(CANDIDATE_HOST)
    expect(production.bodyJson).toContain(PRODUCTION_HOST)
    expect(candidate.headers.contentLength).toBe(new TextEncoder().encode(candidate.bodyJson).byteLength)
    expect(production.headers.contentLength).toBe(new TextEncoder().encode(production.bodyJson).byteLength)
    expect(candidate.headers.contentLength).not.toBe(production.headers.contentLength)
  })

  it("rejects persisted content length and untemplated absolute URL leakage", () => {
    // Given: a caller-authored persisted length and an unknown absolute URL.
    const normalized = normalizeCreateReplay({
      status: 200,
      contentType: "application/json",
      body: createBody(candidateOrigins),
    })
    // When: each mutation crosses its responsible boundary.
    const persistedLength = CreateReplaySchema.safeParse({
      ...normalized.replay,
      headers: { ...normalized.replay.headers, contentLength: 1 },
    })
    const leaked = () => normalizeCreateReplay({
      status: 200,
      contentType: "application/json",
      body: { ...createBody(candidateOrigins), extraUrl: "https://attacker.example/private" },
    })
    const misleadingKind = () => normalizeCreateReplay({
      status: 200,
      contentType: "application/json",
      body: {
        ...createBody(candidateOrigins),
        misleading: { kind: "PUBLIC_URL_LIKE", nested: "https://attacker.example/hidden" },
      },
    })
    // Then: neither stale byte metadata nor an untyped origin can be retained.
    expect(persistedLength.success).toBe(false)
    expect(leaked).toThrow()
    expect(misleadingKind).toThrow()
  })
})
