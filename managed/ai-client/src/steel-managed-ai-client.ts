import {
  AI_ACTION_REQUEST_SCHEMA,
  AI_ASYNC_OUTCOME_STATE,
  StructuralCapabilitiesSchema,
  TOOL_NAME,
  TOOL_NAMES,
  TOOL_VERSION,
  createToolResultSchemas,
  parseAiToolPage,
  selectPublicOrigin,
  type AiActionAcceptedBody,
  type AiActionRequest,
  type AiToolPage,
  type ResultId,
  type SelectedPublicOrigin,
  type StructuralCapabilities,
} from "@happycastle/steel-managed-shared/ai-client"

import { readAccepted, readResult, readSuccessJson } from "./client-response.js"
import { downloadBinary } from "./binary-download.js"
import type {
  AiLiveViewQuery,
  AiLiveViewRead,
  AiResultQuery,
  AiResultRead,
  AiToolPageQuery,
} from "./client-types.js"
import { AiClientProtocolError } from "./errors.js"
import type { AiFetchRequest, SteelManagedAiClientOptions } from "./fetch-contract.js"
import { AI_CLIENT_ROUTE } from "./generated-contract.js"

const HTTP_METHOD = Object.freeze({ GET: "GET", POST: "POST" })
const HEADER = Object.freeze({ ACCEPT: "accept", CONTENT_TYPE: "content-type" })
const MEDIA_TYPE = Object.freeze({ JSON: "application/json" })

export class SteelManagedAiClient {
  readonly #baseUrl: string
  readonly #selectedOrigin: SelectedPublicOrigin
  readonly #actions = new Map<ResultId, AiActionRequest>()
  #capabilities: StructuralCapabilities | undefined

  public constructor(private readonly options: SteelManagedAiClientOptions) {
    const candidate = new URL(options.baseUrl)
    this.#selectedOrigin = selectPublicOrigin(candidate.host, { [candidate.hostname]: options.baseUrl })
    this.#baseUrl = this.#selectedOrigin
  }

  public async capabilities(): Promise<StructuralCapabilities> {
    if (this.#capabilities !== undefined) return this.#capabilities
    const response = await this.options.fetch(this.#baseUrl + AI_CLIENT_ROUTE.CAPABILITIES, this.request(HTTP_METHOD.GET))
    if (response.status !== 200) {
      await readSuccessJson(response)
      throw new AiClientProtocolError("Managed AI capabilities returned an unexpected success status")
    }
    const parsed = StructuralCapabilitiesSchema.safeParse(await readSuccessJson(response))
    if (!parsed.success) throw new AiClientProtocolError("Managed AI API returned invalid capabilities")
    this.#capabilities = parsed.data
    return parsed.data
  }

  public async tools(query: AiToolPageQuery = {}): Promise<AiToolPage> {
    if (query.pageSize !== undefined &&
      (!Number.isSafeInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > TOOL_NAMES.length)) {
      throw new RangeError("tool page size is outside the generated registry")
    }
    const parameters = new URLSearchParams()
    if (query.pageSize !== undefined) parameters.set("pageSize", String(query.pageSize))
    if (query.cursor !== undefined) parameters.set("cursor", query.cursor)
    const suffix = parameters.size === 0 ? "" : `?${parameters.toString()}`
    const capabilities = await this.capabilities()
    const response = await this.options.fetch(this.#baseUrl + AI_CLIENT_ROUTE.TOOLS + suffix, this.request(HTTP_METHOD.GET))
    if (response.status !== 200) {
      await readSuccessJson(response)
      throw new AiClientProtocolError("Managed AI tools returned an unexpected success status")
    }
    const body = await readSuccessJson(response)
    try {
      const parsed = await parseAiToolPage(body, capabilities.tools)
      return Object.freeze({
        apiVersion: parsed.apiVersion,
        items: parsed.items,
        page: parsed.page.nextCursor === undefined
          ? Object.freeze({ pageSize: parsed.page.pageSize, hasMore: parsed.page.hasMore })
          : Object.freeze({
            pageSize: parsed.page.pageSize,
            hasMore: parsed.page.hasMore,
            nextCursor: parsed.page.nextCursor,
          }),
      })
    } catch {
      throw new AiClientProtocolError("Managed AI API returned an invalid tool page")
    }
  }

  public async submitAction(input: AiActionRequest): Promise<AiActionAcceptedBody> {
    const action = AI_ACTION_REQUEST_SCHEMA.parse(input)
    const response = await this.options.fetch(this.#baseUrl + AI_CLIENT_ROUTE.ACTIONS, this.request(
      HTTP_METHOD.POST,
      JSON.stringify(action),
    ))
    const accepted = await readAccepted(response, this.#selectedOrigin)
    this.#actions.set(accepted.resultId, action)
    return accepted
  }

  public async getResult(query: AiResultQuery): Promise<AiResultRead> {
    const action = query.expectedAction === undefined
      ? this.#actions.get(query.resultId)
      : AI_ACTION_REQUEST_SCHEMA.parse(query.expectedAction)
    if (action === undefined) {
      throw new AiClientProtocolError("An expected action is required for result validation")
    }
    const capabilities = await this.capabilities()
    const response = await this.options.fetch(
      this.#baseUrl + AI_CLIENT_ROUTE.RESULT(query.resultId),
      this.request(HTTP_METHOD.GET),
    )
    let result = await readResult(response, query.resultId, action, this.#selectedOrigin, capabilities)
    if (result.state === AI_ASYNC_OUTCOME_STATE.COMPLETED && !("bytes" in result)) {
      const schemas = createToolResultSchemas(this.#selectedOrigin, transport(capabilities))
      const binary = schemas.BinaryResultSchema.safeParse(result.result)
      if (binary.success) {
        result = await downloadBinary({
          fetch: this.options.fetch,
          request: this.request(HTTP_METHOD.GET, undefined, binary.data.contentType),
          result: binary.data,
          maximumBytes: Math.min(capabilities.limits.binaryBytes, capabilities.limits.resultBytes),
        })
      }
    }
    if (result.state === AI_ASYNC_OUTCOME_STATE.COMPLETED) this.#actions.delete(query.resultId)
    return result
  }

  public async getLiveViewResult(query: AiLiveViewQuery): Promise<AiLiveViewRead> {
    const action = AI_ACTION_REQUEST_SCHEMA.parse({
      apiVersion: (await this.capabilities()).apiVersion,
      tool: { name: TOOL_NAME.BROWSER_LIVE_VIEW, version: TOOL_VERSION },
      arguments: { sessionId: query.sessionId },
    })
    const result = await this.getResult({ resultId: query.resultId, expectedAction: action })
    if (result.state === AI_ASYNC_OUTCOME_STATE.PENDING) return result
    if ("bytes" in result) throw new AiClientProtocolError("Live-view action returned binary bytes")
    const schemas = createToolResultSchemas(this.#selectedOrigin, transport(await this.capabilities()))
    const liveView = schemas.LiveViewResultSchema.safeParse(result.result)
    if (!liveView.success || liveView.data.sessionId !== query.sessionId) {
      throw new AiClientProtocolError("Live-view result does not match the requested session")
    }
    return Object.freeze({ ...result, result: liveView.data })
  }

  private request(method: "GET" | "POST", body?: string, accept: string = MEDIA_TYPE.JSON): AiFetchRequest {
    return {
      method,
      credentials: "same-origin",
      headers: {
        ...this.options.headers,
        [HEADER.ACCEPT]: accept,
        ...(body === undefined ? {} : { [HEADER.CONTENT_TYPE]: MEDIA_TYPE.JSON }),
      },
      ...(body === undefined ? {} : { body }),
    }
  }

}

function transport(capabilities: StructuralCapabilities) {
  return {
    httpBodyBytes: capabilities.limits.httpBodyBytes,
    textBytes: capabilities.limits.textBytes,
    binaryBytes: capabilities.limits.binaryBytes,
    resultBytes: capabilities.limits.resultBytes,
  }
}
