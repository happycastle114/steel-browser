import { createHmac } from "node:crypto"
import { readFileSync } from "node:fs"

import { z } from "zod"
import { describe, expect, it } from "vitest"

import {
  buildRandomCreateToken,
  deriveCreateCorrelation,
  parseCreateTokenKey,
} from "../src/create-correlation.js"
import { CONTROL_PLANE_SESSION_ID_MODE } from "../src/control-plane-vocabulary.js"
import {
  PublicOriginSchema,
  buildSessionUrls,
  buildLiveViewUrls,
  buildResultDownloadUrl,
  selectPublicOrigin,
} from "../src/public-urls.js"
import { ResultIdSchema, SessionIdSchema } from "../src/control-plane-primitives.js"
import { RESULT_KIND, SESSION_STATE } from "../src/control-plane-vocabulary.js"
import { ManagedTransportConfigSchema } from "../src/managed-transport-config.js"
import { createToolResultSchemas } from "../src/tool-result-schemas.js"

const VectorSchema = z.object({
  keyHex: z.string(),
  principalKind: z.string(),
  principalId: z.string(),
  idempotencyKey: z.string(),
  requestBody: z.record(z.unknown()),
  sessionIdMode: z.nativeEnum(CONTROL_PLANE_SESSION_ID_MODE),
  ownerPreimageHex: z.string(),
  ownerSha256: z.string(),
  requestCanonical: z.string(),
  requestSha256: z.string(),
  tokenPreimageHex: z.string(),
  createToken: z.string(),
}).strict()

const vector = VectorSchema.parse(
  JSON.parse(readFileSync(new URL("./fixtures/hmac-vector.json", import.meta.url), "utf8")),
)

describe("byte-level create correlation", () => {
  it("matches the committed non-ASCII and raw-nested-digest vector", async () => {
    // Given: a Python-generated vector with UTF-8 principal/body data.
    const key = parseCreateTokenKey(vector.keyHex)
    // When: browser-compatible Web Crypto derives all correlation fields.
    const actual = await deriveCreateCorrelation({
      key,
      principalKind: vector.principalKind,
      principalId: vector.principalId,
      idempotencyKey: vector.idempotencyKey,
      requestBody: vector.requestBody,
      sessionIdMode: vector.sessionIdMode,
    })
    // Then: every preimage and digest matches byte-for-byte.
    expect(actual).toEqual({
      ownerPreimageHex: vector.ownerPreimageHex,
      ownerSha256: vector.ownerSha256,
      requestCanonical: vector.requestCanonical,
      requestSha256: vector.requestSha256,
      tokenPreimageHex: vector.tokenPreimageHex,
      createToken: vector.createToken,
    })
  })

  it("proves the nested HMAC consumes raw digest bytes", () => {
    // Given: the committed owner digest and token preimage.
    const key = Buffer.from(vector.keyHex, "hex")
    const expected = `h1_${createHmac("sha256", key).update(Buffer.from(vector.tokenPreimageHex, "hex")).digest("hex")}`
    // When: a regression substitutes lowercase-hex ASCII for raw owner bytes.
    const wrongPreimage = Buffer.concat([
      Buffer.from("steel-create-v1"),
      Buffer.from([0, 0, 0, 64]),
      Buffer.from(vector.ownerSha256),
      Buffer.from([0, 0, 0, Buffer.byteLength(vector.idempotencyKey)]),
      Buffer.from(vector.idempotencyKey),
    ])
    const wrong = `h1_${createHmac("sha256", key).update(wrongPreimage).digest("hex")}`
    // Then: only the raw-byte preimage reproduces the contract token.
    expect(expected).toBe(vector.createToken)
    expect(wrong).not.toBe(vector.createToken)
  })

  it("accepts only exact 32-byte lowercase-hex keys", () => {
    // Given: malformed key-file representations.
    const malformed = ["a".repeat(63), "A".repeat(64), "zz".repeat(32)]
    // When: each is decoded at the file boundary.
    const parseResults = malformed.map((value) => () => parseCreateTokenKey(value))
    // Then: every malformed form fails closed.
    for (const parse of parseResults) expect(parse).toThrow()
  })

  it("formats only canonical UUIDv4 random create tokens", () => {
    // Given: a canonical lowercase UUIDv4.
    const uuid = "018f56c8-6f7a-4c45-9e5d-77adff18f7ac"
    // When: an unkeyed compatibility token is built.
    const token = buildRandomCreateToken(uuid)
    // Then: the fixed r1 prefix is preserved.
    expect(token).toBe(`r1_${uuid}`)
  })
})

describe("typed same-origin public URLs", () => {
  const sessionId = SessionIdSchema.parse("118f56c8-6f7a-4c45-9e5d-77adff18f7ac")
  const resultId = ResultIdSchema.parse("318f56c8-6f7a-4c45-9e5d-77adff18f7ac")
  const selectedOrigin = selectPublicOrigin("steel.soungmin.kr", {
    "steel.soungmin.kr": "https://steel.soungmin.kr",
  })
  const transport = ManagedTransportConfigSchema.parse({
    httpBodyBytes: 1_024,
    textBytes: 1_024,
    binaryBytes: 1_024,
    resultBytes: 4_096,
  })
  const { BinaryResultSchema, LiveViewResultSchema, SessionResultSchema } = createToolResultSchemas(
    selectedOrigin,
    transport,
  )

  it("builds distinct exact viewer and cast URLs", () => {
    // Given: a validated candidate origin and current session.
    const origin = selectPublicOrigin("steel-candidate.soungmin.kr", {
      "steel-candidate.soungmin.kr": "https://steel-candidate.soungmin.kr",
    })
    // When: live-view URLs are generated.
    const urls = buildLiveViewUrls(origin, sessionId)
    // Then: viewer HTML and cast transport stay distinct and same-slot.
    expect(urls).toEqual({
      viewerUrl: `https://steel-candidate.soungmin.kr/ui/sessions/${sessionId}/live`,
      castWebSocketUrl: `wss://steel-candidate.soungmin.kr/v1/sessions/${sessionId}/cast`,
    })
  })

  it("selects an origin only by an exact validated host map", () => {
    // Given: disjoint production and candidate origins.
    const origins = {
      "steel.soungmin.kr": "https://steel.soungmin.kr",
      "steel-candidate.soungmin.kr": "https://steel-candidate.soungmin.kr",
    }
    // When: the normalized candidate host is selected.
    const selected = selectPublicOrigin("STEEL-CANDIDATE.SOUNGMIN.KR:443", origins)
    // Then: only the candidate origin is returned.
    expect(selected).toBe("https://steel-candidate.soungmin.kr")
  })

  it("rejects path, query, credential, and non-HTTPS origins", () => {
    // Given: origins forbidden by the Host-to-origin contract.
    const invalid = [
      "http://steel.soungmin.kr",
      "https://steel.soungmin.kr/path",
      "https://steel.soungmin.kr/",
      "https://STEEL.soungmin.kr",
      "https://steel.soungmin.kr:443",
      "https://steel.soungmin.kr?x=1",
      "https://user@steel.soungmin.kr",
    ]
    // When: each origin crosses the boundary.
    const results = invalid.map((value) => PublicOriginSchema.safeParse(value).success)
    // Then: none are accepted.
    expect(results).toEqual([false, false, false, false, false, false, false])
  })

  it("builds session URLs from an allowlisted origin without duplicate separators", () => {
    // Given: an exact Host selected from configured public origins.
    const origin = selectPublicOrigin("steel.soungmin.kr", {
      "steel.soungmin.kr": "https://steel.soungmin.kr",
    })
    // When: public session routes are generated for one session.
    const urls = buildSessionUrls(origin, sessionId)
    // Then: every secure facade URL has one separator and the same session identity.
    expect(urls).toEqual({
      websocketUrl: `wss://steel.soungmin.kr/v1/sessions/${sessionId}`,
      debugUrl: `https://steel.soungmin.kr/v1/sessions/${sessionId}/debug`,
      viewerUrl: `https://steel.soungmin.kr/ui/sessions/${sessionId}/live`,
    })
    expect(Object.values(urls).every((value) => !new URL(value).pathname.startsWith("//"))).toBe(true)
    expect(SessionResultSchema.safeParse(sessionResultInput({})).success).toBe(true)
  })

  it.each([
    `ws://steel.soungmin.kr/v1/sessions/${sessionId}`,
    `wss://worker-00:3000/v1/sessions/${sessionId}`,
    `wss://manager.internal/v1/sessions/${sessionId}`,
    `wss://127.0.0.1/v1/sessions/${sessionId}`,
  ])("rejects insecure or private SessionResult websocket URL %s", (websocketUrl) => {
    // Given: a live managed session paired with an untrusted websocket address.
    const input = sessionResultInput({ websocketUrl })
    // When: the public result boundary parses it.
    // Then: private worker and insecure transports never escape.
    expect(SessionResultSchema.safeParse(input).success).toBe(false)
  })

  it.each([
    { debugUrl: "http://manager:3000/debug" },
    { debugUrl: `http://steel.soungmin.kr/v1/sessions/${sessionId}/debug` },
    { debugUrl: `https://worker.cluster.local/v1/sessions/${sessionId}/debug` },
    { viewerUrl: `http://steel.soungmin.kr/ui/sessions/${sessionId}/live` },
  ])("rejects an insecure or private optional SessionResult URL", (urlOverrides) => {
    // Given: an optional debug or viewer URL outside the secure public facade.
    const input = sessionResultInput(urlOverrides)
    // When: the static SessionResult boundary validates it.
    // Then: internal Hosts and insecure HTTP transports fail closed.
    expect(SessionResultSchema.safeParse(input).success).toBe(false)
  })

  it("returns schema failures instead of throwing for malformed URL text", () => {
    // Given: values that cannot construct a WHATWG URL.
    const malformed = ["not-a-url", "://"]
    // When: public origin and session websocket schemas safely parse them.
    const results = malformed.flatMap((value) => [
      PublicOriginSchema.safeParse(value).success,
      SessionResultSchema.safeParse(sessionResultInput({ websocketUrl: value })).success,
    ])
    // Then: every malformed boundary value is a normal validation failure.
    expect(results).toEqual([false, false, false, false])
  })

  it("rejects cross-host and cross-session SessionResult URL aliases", () => {
    // Given: otherwise secure URLs that diverge from the websocket Host or session.
    const otherSessionId = "418f56c8-6f7a-4c45-9e5d-77adff18f7ac"
    const cases = [
      sessionResultInput({ debugUrl: `https://steel-candidate.soungmin.kr/v1/sessions/${sessionId}/debug` }),
      sessionResultInput({ viewerUrl: `https://steel.soungmin.kr/ui/sessions/${otherSessionId}/live` }),
      sessionResultInput({ websocketUrl: `wss://steel.soungmin.kr/v1/sessions/${otherSessionId}` }),
    ]
    // When: each alias crosses the static SessionResult boundary.
    const results = cases.map((input) => SessionResultSchema.safeParse(input).success)
    // Then: Host and all embedded session identities remain exact.
    expect(results).toEqual([false, false, false])
  })

  function sessionResultInput(urlOverrides: Readonly<Record<string, string>>) {
    const origin = selectPublicOrigin("steel.soungmin.kr", {
      "steel.soungmin.kr": "https://steel.soungmin.kr",
    })
    return {
      kind: RESULT_KIND.SESSION,
      session: {
        sessionId,
        state: SESSION_STATE.LIVE,
        createdAt: "2026-07-20T00:00:00.000Z",
      },
      urls: { ...buildSessionUrls(origin, sessionId), ...urlOverrides },
    }
  }

  it.each([
    "https://localhost",
    "https://127.0.0.1",
    "https://[::1]",
    "https://10.0.0.8",
    "https://172.16.0.8",
    "https://192.168.1.8",
    "https://worker-00",
    "https://manager.internal",
    "https://worker.cluster.local",
    "https://steel.home.arpa",
    "https://steel.example",
    "https://steel.lan",
    "https://steel.test",
    "https://steel.onion",
  ])("rejects loopback, private, internal, or worker origin %s", (origin) => {
    // Given: a non-public origin that must never escape a worker or cluster boundary.
    // When: it crosses the configured public-origin schema.
    const result = PublicOriginSchema.safeParse(origin)
    // Then: the public URL boundary rejects it.
    expect(result.success).toBe(false)
  })

  it("rejects an otherwise public request Host absent from configured origins", () => {
    // Given: a syntactically public request Host outside the configured Host map.
    const origins = { "steel.soungmin.kr": "https://steel.soungmin.kr" }
    // When: public origin selection is attempted.
    const select = () => selectPublicOrigin("attacker.example.com", origins)
    // Then: the unconfigured Host cannot influence emitted URLs.
    expect(select).toThrow()
  })

  it("builds the exact authenticated result route", () => {
    // Given: a production origin and random result ID.
    const origin = selectedOrigin
    // When: the download URL is generated.
    const url = buildResultDownloadUrl(origin, resultId)
    // Then: the route parameter is the exact result ID.
    expect(url).toBe(`https://steel.soungmin.kr/v1/results/${resultId}`)
  })

  it("rejects live-view URLs for a different session or Host", () => {
    // Given: a live-view result whose viewer and cast URLs do not bind one instance route.
    const otherSessionId = "418f56c8-6f7a-4c45-9e5d-77adff18f7ac"
    const input = {
      kind: RESULT_KIND.LIVE_VIEW,
      sessionId,
      viewerUrl: `https://steel.soungmin.kr/ui/sessions/${otherSessionId}/live`,
      castWebSocketUrl: `wss://steel-candidate.soungmin.kr/v1/sessions/${sessionId}/cast`,
    }
    // When: the exact live-view output boundary parses it.
    // Then: cross-session and cross-slot aliases fail closed.
    expect(LiveViewResultSchema.safeParse(input).success).toBe(false)
  })

  it("rejects a result URL for a different result ID", () => {
    // Given: retained binary metadata whose authenticated route points elsewhere.
    const input = {
      kind: RESULT_KIND.BINARY,
      sessionId,
      resultId,
      contentType: "image/png",
      byteLength: 4,
      sha256: "a".repeat(64),
      expiresAt: "2026-07-20T00:01:00.000Z",
      downloadUrl: `https://steel.soungmin.kr/v1/results/418f56c8-6f7a-4c45-9e5d-77adff18f7ac`,
    }
    // When: the binary result boundary parses it.
    // Then: URL and retained result identity cannot diverge.
    expect(BinaryResultSchema.safeParse(input).success).toBe(false)
  })

})
