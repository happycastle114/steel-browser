import { createHash } from "node:crypto"

import {
  AI_ACTION_REQUEST_SCHEMA,
  AI_ASYNC_OUTCOME_STATE,
  BINARY_CONTENT_TYPE,
  CONTROL_PLANE_API_VERSION,
  CONTROL_PLANE_SERVICE_NAME,
  MCP_PROTOCOL_VERSION,
  RESULT_KIND,
  ResultIdSchema,
  SessionIdSchema,
  TOOL_VERSION,
  buildLiveViewUrls,
  buildResultDownloadUrl,
  selectPublicOrigin,
} from "@happycastle/steel-managed-shared/browser"
import { createToolContractCatalog } from "@happycastle/steel-managed-shared"
import { describe, expect, it } from "vitest"

import {
  AiClientProtocolError,
  SteelManagedAiClient,
  type AiFetch,
  type AiFetchResponse,
} from "../src/index.js"

const baseUrl = "https://steel.soungmin.tech"
const selectedOrigin = selectPublicOrigin("steel.soungmin.tech", { "steel.soungmin.tech": baseUrl })
const resultId = ResultIdSchema.parse("018f56c8-6f7a-4c45-9e5d-77adff18f7ac")
const sessionId = SessionIdSchema.parse("118f56c8-6f7a-4c45-9e5d-77adff18f7ac")
const limits = {
  httpHeaderBytes: 16_384,
  httpBodyBytes: 1_048_576,
  httpConnectionCount: 64,
  httpConnectionReservedBytes: 16_384,
  httpBodyCount: 16,
  httpBodyReservedBytes: 1_048_576,
  textBytes: 65_536,
  binaryBytes: 1_048_576,
  resultBytes: 8_388_608,
  resultCount: 64,
  actionTimeoutMs: 30_000,
  actionCount: 16,
  webSocketCount: 8,
  webSocketReservedBytes: 65_536,
} as const
const contracts = createToolContractCatalog({ selectedOrigin, limits })
const capabilities = contracts.capabilitiesSchema.parse({
  apiVersion: CONTROL_PLANE_API_VERSION,
  service: { name: CONTROL_PLANE_SERVICE_NAME, version: TOOL_VERSION },
  mcp: { endpoint: "/mcp", protocolVersion: MCP_PROTOCOL_VERSION, stateless: true },
  tools: contracts.descriptors,
  limits,
})
const action = AI_ACTION_REQUEST_SCHEMA.parse({
  apiVersion: CONTROL_PLANE_API_VERSION,
  tool: { name: "steel.browser.live_view", version: TOOL_VERSION },
  arguments: { sessionId },
})

type ResponseFixture = Readonly<{
  readonly status: number
  readonly body: unknown
  readonly bytes?: Uint8Array
  readonly headers?: Readonly<Record<string, string>>
}>

function response(fixture: ResponseFixture): AiFetchResponse {
  const headerMap = new Map(Object.entries(fixture.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]))
  return {
    status: fixture.status,
    ok: fixture.status >= 200 && fixture.status < 300,
    headers: { get: (name) => headerMap.get(name.toLowerCase()) ?? null },
    json: async () => fixture.body,
    arrayBuffer: async () => Uint8Array.from(
      fixture.bytes ?? new TextEncoder().encode(String(fixture.body)),
    ).buffer,
  }
}

function queuedFetch(fixtures: readonly ResponseFixture[]): AiFetch {
  const queue = [...fixtures]
  return async () => {
    const fixture = queue.shift()
    if (fixture === undefined) throw new TypeError("unexpected test fetch")
    return response(fixture)
  }
}

describe("generated browser-safe managed AI client", () => {
  it("validates capabilities before accepting action outcomes", async () => {
    const client = new SteelManagedAiClient({
      baseUrl,
      fetch: queuedFetch([
        { status: 200, body: capabilities },
        {
          status: 202,
          headers: {
            location: `${baseUrl}/v1/results/${resultId}`,
            "retry-after": "2",
          },
          body: {
            apiVersion: CONTROL_PLANE_API_VERSION,
            resultId,
            state: AI_ASYNC_OUTCOME_STATE.ACCEPTED,
            retryAfterSeconds: 2,
            requestId: "218f56c8-6f7a-4c45-9e5d-77adff18f7ac",
            correlationId: "318f56c8-6f7a-4c45-9e5d-77adff18f7ac",
          },
        },
      ]),
    })

    expect((await client.capabilities()).tools).toHaveLength(14)
    expect((await client.submitAction(action)).resultId).toBe(resultId)
  })

  it("omits the terminal tool-page cursor from the browser client result", async () => {
    const client = new SteelManagedAiClient({
      baseUrl,
      fetch: queuedFetch([
        { status: 200, body: capabilities },
        {
          status: 200,
          body: {
            apiVersion: CONTROL_PLANE_API_VERSION,
            items: contracts.schemaDescriptors,
            page: { pageSize: contracts.schemaDescriptors.length, hasMore: false },
          },
        },
      ]),
    })

    const page = await client.tools()

    expect(page.page).toEqual({ pageSize: contracts.schemaDescriptors.length, hasMore: false })
    expect(page.page).not.toHaveProperty("nextCursor")
  })

  it("rejects tool schema bytes that do not match the capability digests", async () => {
    const firstTool = contracts.schemaDescriptors[0]
    if (firstTool === undefined) throw new TypeError("canonical tool descriptor missing")
    const client = new SteelManagedAiClient({
      baseUrl,
      fetch: queuedFetch([
        { status: 200, body: capabilities },
        {
          status: 200,
          body: {
            apiVersion: CONTROL_PLANE_API_VERSION,
            items: [
              { ...firstTool, inputSchema: { type: "object", properties: {} } },
              ...contracts.schemaDescriptors.slice(1),
            ],
            page: { pageSize: contracts.schemaDescriptors.length, hasMore: false },
          },
        },
      ]),
    })

    await expect(client.tools()).rejects.toBeInstanceOf(AiClientProtocolError)
  })

  it("rejects an accepted Location from another public origin", async () => {
    const client = new SteelManagedAiClient({
      baseUrl,
      fetch: queuedFetch([
        {
          status: 202,
          headers: {
            location: `https://steel-candidate.soungmin.tech/v1/results/${resultId}`,
            "retry-after": "2",
          },
          body: {
            apiVersion: CONTROL_PLANE_API_VERSION,
            resultId,
            state: AI_ASYNC_OUTCOME_STATE.ACCEPTED,
            retryAfterSeconds: 2,
            requestId: "218f56c8-6f7a-4c45-9e5d-77adff18f7ac",
            correlationId: "318f56c8-6f7a-4c45-9e5d-77adff18f7ac",
          },
        },
      ]),
    })

    await expect(client.submitAction(action)).rejects.toBeInstanceOf(AiClientProtocolError)
  })

  it("binds a live-view result to the requested result and session", async () => {
    const liveView = { kind: RESULT_KIND.LIVE_VIEW, sessionId, ...buildLiveViewUrls(selectedOrigin, sessionId) }
    const client = new SteelManagedAiClient({
      baseUrl,
      fetch: queuedFetch([
        { status: 200, body: capabilities },
        {
          status: 200,
          headers: { "content-type": "application/json" },
          body: {
            apiVersion: CONTROL_PLANE_API_VERSION,
            resultId,
            state: AI_ASYNC_OUTCOME_STATE.COMPLETED,
            result: liveView,
            requestId: "218f56c8-6f7a-4c45-9e5d-77adff18f7ac",
            correlationId: "318f56c8-6f7a-4c45-9e5d-77adff18f7ac",
          },
        },
      ]),
    })

    const completed = await client.getLiveViewResult({ resultId, sessionId })
    expect(completed.state).toBe(AI_ASYNC_OUTCOME_STATE.COMPLETED)
    if (completed.state !== AI_ASYNC_OUTCOME_STATE.COMPLETED) throw new TypeError("live view remained pending")
    expect(completed.result).toEqual(liveView)
  })

  it("downloads and verifies retained binary bytes after its descriptor", async () => {
    const bytes = new TextEncoder().encode("managed-screenshot")
    const screenshotAction = AI_ACTION_REQUEST_SCHEMA.parse({
      apiVersion: CONTROL_PLANE_API_VERSION,
      tool: { name: "steel.browser.screenshot", version: TOOL_VERSION },
      arguments: { sessionId, format: "png", fullPage: true },
    })
    const descriptor = {
      kind: RESULT_KIND.BINARY,
      sessionId,
      resultId,
      contentType: BINARY_CONTENT_TYPE.PNG,
      byteLength: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      expiresAt: "2026-07-21T12:00:00.000Z",
      downloadUrl: buildResultDownloadUrl(selectedOrigin, resultId),
    }
    const client = new SteelManagedAiClient({
      baseUrl,
      fetch: queuedFetch([
        { status: 200, body: capabilities },
        {
          status: 200,
          headers: { "content-type": "application/json" },
          body: {
            apiVersion: CONTROL_PLANE_API_VERSION,
            resultId,
            state: AI_ASYNC_OUTCOME_STATE.COMPLETED,
            result: descriptor,
            requestId: "218f56c8-6f7a-4c45-9e5d-77adff18f7ac",
            correlationId: "318f56c8-6f7a-4c45-9e5d-77adff18f7ac",
          },
        },
        {
          status: 200,
          body: undefined,
          bytes,
          headers: { "content-type": BINARY_CONTENT_TYPE.PNG, "content-length": String(bytes.byteLength) },
        },
      ]),
    })

    const completed = await client.getResult({ resultId, expectedAction: screenshotAction })

    expect("bytes" in completed ? [...completed.bytes] : undefined).toEqual([...bytes])
  })
})
