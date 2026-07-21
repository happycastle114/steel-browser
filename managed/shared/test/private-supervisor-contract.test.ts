import { describe, expect, it } from "vitest"

import {
  CREATE_JOURNAL_STATE,
  CreateReplayRecordSchema,
  CreateTokenSchema,
  MANAGED_CREATE_HEADER,
  ManagedCreateHeaderValuesSchema,
  PRIVATE_SUPERVISOR_BODY_LIMIT,
  PRIVATE_SUPERVISOR_ERROR_CODE,
  PRIVATE_SUPERVISOR_METHOD,
  PRIVATE_SUPERVISOR_RETRY_AFTER_SECONDS,
  PRIVATE_SUPERVISOR_ROUTE,
  PRIVATE_SUPERVISOR_ROUTE_ID,
  PRIVATE_SUPERVISOR_ROUTE_REGISTRY,
  PRIVATE_SUPERVISOR_RESPONSE_KIND,
  PrivateSupervisorCreateLookupParamsSchema,
  PrivateSupervisorWireResponseSchema,
  WORKER_IDENTITY_HEADER,
  buildPrivateSupervisorCreateLookupPath,
} from "../src/private-supervisor-contract.js"

const INSTANCE_ID = "11223344-5566-4788-99aa-bbccddeeff00"
const MANAGER_INSTANCE_ID = "21223344-5566-4788-99aa-bbccddeeff00"
const SESSION_ID = "77c0575c-2513-4db5-a80e-8e2675041fcb"
const TOKEN = `h1_${"a".repeat(64)}`

const identityHeaders = (body: unknown) => ({
  [WORKER_IDENTITY_HEADER.INSTANCE_ID]: INSTANCE_ID,
  [WORKER_IDENTITY_HEADER.WORKER_ID]: "worker-00",
  "content-length": String(new TextEncoder().encode(JSON.stringify(body)).byteLength),
  "content-type": "application/json; charset=utf-8",
})

const pendingRecord = {
  expiresAt: "2026-07-21T01:10:00.000Z",
  ownerSha256: "b".repeat(64),
  requestSha256: "c".repeat(64),
  state: CREATE_JOURNAL_STATE.UPSTREAM_PENDING,
  token: TOKEN,
  updatedAt: "2026-07-21T01:00:00.000Z",
}

const liveRecord = {
  ...pendingRecord,
  replay: {
    bodyTemplate: { id: SESSION_ID },
    headers: { contentType: "application/json" },
    status: 200,
  },
  state: CREATE_JOURNAL_STATE.LIVE,
  upstreamSessionId: SESSION_ID,
}

describe("canonical private supervisor contract", () => {
  it("publishes exactly the three closed private GET routes", () => {
    // Given: the canonical registry shared by worker, gateway, and manager.
    const registry = PRIVATE_SUPERVISOR_ROUTE_REGISTRY

    // When: consumers enumerate its method and path pairs.
    const pairs = registry.map(({ method, path }) => [method, path])

    // Then: no proxy or legacy route can enter the private supervisor surface.
    expect(pairs).toEqual([
      ["GET", "/v1/managed-worker/meta"],
      ["GET", "/v1/managed-worker/creates?scope=active"],
      ["GET", "/v1/managed-worker/creates/:token"],
    ])
    expect(new Set(registry.map(({ id }) => id))).toEqual(new Set(Object.values(PRIVATE_SUPERVISOR_ROUTE_ID)))
    expect(Object.isFrozen(registry)).toBe(true)
    expect(PRIVATE_SUPERVISOR_BODY_LIMIT).toEqual({ META: 4_096, CREATES_ACTIVE: 65_536, CREATES_TOKEN: 32_768 })
    expect(PRIVATE_SUPERVISOR_RETRY_AFTER_SECONDS).toBe(1)
  })

  it("accepts only branded create lookup tokens", () => {
    // Given: a keyed token and an untrusted traversal-like token.
    const canonical = CreateTokenSchema.parse(TOKEN)

    // When: both values cross the route-parameter boundary.
    const accepted = PrivateSupervisorCreateLookupParamsSchema.safeParse({ token: canonical })
    const rejected = PrivateSupervisorCreateLookupParamsSchema.safeParse({ token: "../active" })

    // Then: only the canonical token identifier is admitted.
    expect(accepted.success).toBe(true)
    expect(rejected.success).toBe(false)
  })

  it("builds token lookup paths from a branded identifier", () => {
    // Given: a create token parsed at the trust boundary.
    const token = CreateTokenSchema.parse(TOKEN)

    // When: a manager builds the private lookup path.
    const path = buildPrivateSupervisorCreateLookupPath(token)

    // Then: the path preserves the complete canonical identifier.
    expect(path).toBe(`/v1/managed-worker/creates/${TOKEN}`)
  })

  it("admits only digest-safe managed create headers", () => {
    // Given: the exact private create headers with no raw principal or idempotency key.
    const headers = {
      [MANAGED_CREATE_HEADER.MANAGER_INSTANCE_ID]: MANAGER_INSTANCE_ID,
      [MANAGED_CREATE_HEADER.OWNER_SHA256]: "b".repeat(64),
      [MANAGED_CREATE_HEADER.POOL_ID]: "managed-blue",
      [MANAGED_CREATE_HEADER.REQUEST_SHA256]: "c".repeat(64),
      [MANAGED_CREATE_HEADER.TOKEN]: TOKEN,
    }

    // When: canonical and caller-expanded header sets are parsed.
    const accepted = ManagedCreateHeaderValuesSchema.safeParse(headers)
    const rejected = ManagedCreateHeaderValuesSchema.safeParse({ ...headers, "X-Managed-Principal": "alice" })

    // Then: only typed identifiers and digests cross the worker boundary.
    expect(accepted.success).toBe(true)
    expect(rejected.success).toBe(false)
  })

  it("keeps correlation identity and replay out of every pending journal state", () => {
    // Given: a canonical uncertain record and identity/replay mutations of pending states.
    const uncertain = { ...pendingRecord, state: CREATE_JOURNAL_STATE.UNCERTAIN }
    const mutations = [
      { ...uncertain, upstreamSessionId: SESSION_ID },
      { ...uncertain, replay: liveRecord.replay, upstreamSessionId: SESSION_ID },
      { ...uncertain, privateUrl: "http://127.0.0.1:3001/", viewerUrl: "https://steel.example.test/" },
      { ...pendingRecord, state: CREATE_JOURNAL_STATE.ACCEPTED, upstreamSessionId: SESSION_ID },
      { ...pendingRecord, upstreamSessionId: SESSION_ID },
    ]

    // When: the canonical replay-record boundary parses the evidence variants.
    const accepted = CreateReplayRecordSchema.safeParse(uncertain)
    const rejected = mutations.map((record) => CreateReplayRecordSchema.safeParse(record))

    // Then: only the state-only uncertain record is representable.
    expect(accepted.success).toBe(true)
    expect(rejected.every((result) => !result.success)).toBe(true)
  })

  it("binds pending lookup state to 202 and retry-after", () => {
    // Given: a pending lookup response carrying the exact retry hint.
    const response = {
      body: pendingRecord,
      headers: {
        ...identityHeaders(pendingRecord),
        "retry-after": String(PRIVATE_SUPERVISOR_RETRY_AFTER_SECONDS),
      },
      kind: PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_TOKEN_PENDING,
      status: 202,
    }

    // When: valid and header-mutated responses cross the wire boundary.
    const accepted = PrivateSupervisorWireResponseSchema.safeParse(response)
    const rejected = PrivateSupervisorWireResponseSchema.safeParse({ ...response, headers: identityHeaders(pendingRecord) })

    // Then: a pending response without retry metadata is impossible.
    expect(accepted.success).toBe(true)
    expect(rejected.success).toBe(false)
  })

  it("accepts every declared success and error wire variant", () => {
    // Given: exact metadata, enumeration, complete lookup, and missing lookup responses.
    const metadata = {
      browserVersion: "140.0.7339.16",
      instanceId: INSTANCE_ID,
      journalVersion: 1,
      upstreamSha: "d".repeat(40),
      workerId: "worker-00",
    }
    const enumeration = { creates: [pendingRecord] }
    const missing = { code: PRIVATE_SUPERVISOR_ERROR_CODE.CREATE_NOT_FOUND }
    const responses = [
      { body: metadata, headers: identityHeaders(metadata), kind: PRIVATE_SUPERVISOR_RESPONSE_KIND.META, status: 200 },
      { body: enumeration, headers: identityHeaders(enumeration), kind: PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_ACTIVE, status: 200 },
      { body: liveRecord, headers: identityHeaders(liveRecord), kind: PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_TOKEN_COMPLETE, status: 200 },
      { body: missing, headers: identityHeaders(missing), kind: PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_TOKEN_ERROR, status: 404 },
    ]

    // When: every declared variant crosses the canonical wire boundary.
    const results = responses.map((response) => PrivateSupervisorWireResponseSchema.safeParse(response))

    // Then: the complete closed surface is representable without weakening a schema.
    expect(results.every((result) => result.success)).toBe(true)
  })

  it("enumerates at most one nonterminal create", () => {
    // Given: a two-create envelope and a terminal create envelope.
    const released = { ...liveRecord, state: CREATE_JOURNAL_STATE.RELEASED_TERMINAL }
    const candidates = [
      { creates: [pendingRecord, pendingRecord] },
      { creates: [released] },
    ]

    // When: both invalid active enumerations cross the body boundary.
    const results = candidates.map((body) => {
      return PrivateSupervisorWireResponseSchema.safeParse({
        body,
        headers: identityHeaders(body),
        kind: PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_ACTIVE,
        status: 200,
      })
    })

    // Then: cardinality and lifecycle membership are both closed.
    expect(results.every((result) => !result.success)).toBe(true)
  })

  it("rejects 200-on-pending and 202-on-complete mutations", () => {
    // Given: state/status pairs with their discriminants deliberately crossed.
    const pendingAsComplete = {
      body: pendingRecord,
      headers: identityHeaders(pendingRecord),
      kind: PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_TOKEN_COMPLETE,
      status: 200,
    }
    const completeAsPending = {
      body: liveRecord,
      headers: { ...identityHeaders(liveRecord), "retry-after": "1" },
      kind: PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_TOKEN_PENDING,
      status: 202,
    }

    // When: both mutations are parsed.
    const mutations = [pendingAsComplete, completeAsPending].map((value) =>
      PrivateSupervisorWireResponseSchema.safeParse(value),
    )

    // Then: state controls the only legal HTTP outcome.
    expect(mutations.every((result) => !result.success)).toBe(true)
  })

  it("bounds metadata, active enumeration, and token lookup independently", () => {
    // Given: one otherwise-valid response per private route above its own byte ceiling.
    const oversizedActiveBody = {
      creates: [{
        ...liveRecord,
        replay: { ...liveRecord.replay, bodyTemplate: "x".repeat(PRIVATE_SUPERVISOR_BODY_LIMIT.CREATES_ACTIVE) },
      }],
    }
    const oversizedLookupBody = {
      ...liveRecord,
      replay: { ...liveRecord.replay, bodyTemplate: "x".repeat(PRIVATE_SUPERVISOR_BODY_LIMIT.CREATES_TOKEN) },
    }
    const metadataBody = {
      browserVersion: "140.0.7339.16",
      instanceId: INSTANCE_ID,
      journalVersion: 1,
      upstreamSha: "d".repeat(40),
      workerId: "worker-00",
    }
    const oversized = [
      {
        body: metadataBody,
        headers: { ...identityHeaders(metadataBody), "content-length": String(PRIVATE_SUPERVISOR_BODY_LIMIT.META + 1) },
        kind: PRIVATE_SUPERVISOR_RESPONSE_KIND.META,
        status: 200,
      },
      {
        body: oversizedActiveBody,
        headers: identityHeaders(oversizedActiveBody),
        kind: PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_ACTIVE,
        status: 200,
      },
      {
        body: oversizedLookupBody,
        headers: identityHeaders(oversizedLookupBody),
        kind: PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_TOKEN_COMPLETE,
        status: 200,
      },
    ]

    // When: each oversized response crosses its route boundary.
    const results = oversized.map((value) => PrivateSupervisorWireResponseSchema.safeParse(value))

    // Then: every endpoint enforces its declared response budget.
    expect(results.every((result) => !result.success)).toBe(true)
  })

  it("accepts only the route-specific strict error variants", () => {
    // Given: the active-probe error and an invented token-lookup error.
    const activeError = {
      body: { code: PRIVATE_SUPERVISOR_ERROR_CODE.UPSTREAM_OBSERVATION_UNAVAILABLE },
      headers: identityHeaders({ code: PRIVATE_SUPERVISOR_ERROR_CODE.UPSTREAM_OBSERVATION_UNAVAILABLE }),
      kind: PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_ACTIVE_ERROR,
      status: 503,
    }
    const invented = {
      ...activeError,
      body: { code: "CREATE_NOT_FOUND" },
    }

    // When: both error envelopes are parsed.
    const accepted = PrivateSupervisorWireResponseSchema.safeParse(activeError)
    const rejected = PrivateSupervisorWireResponseSchema.safeParse(invented)

    // Then: status, route, and error code stay correlated.
    expect(accepted.success).toBe(true)
    expect(rejected.success).toBe(false)
  })

  it("keeps each registry response schema bound to its own route", () => {
    // Given: the metadata route and a valid token lookup response.
    const metadataRoute = PRIVATE_SUPERVISOR_ROUTE_REGISTRY.find(({ id }) => id === PRIVATE_SUPERVISOR_ROUTE_ID.META)
    if (metadataRoute === undefined) throw new TypeError("metadata route is missing")
    const lookup = {
      body: liveRecord,
      headers: identityHeaders(liveRecord),
      kind: PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_TOKEN_COMPLETE,
      status: 200,
    }

    // When: the lookup response is parsed through the metadata registry entry.
    const result = metadataRoute.responseSchema.safeParse(lookup)

    // Then: a valid response for another route is still rejected.
    expect(result.success).toBe(false)
  })
})
