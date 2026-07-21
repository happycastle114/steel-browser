import {
  AI_ASYNC_OUTCOME_STATE,
  AiActionAcceptedBodySchema,
  TOOL_NAMES,
} from "@happycastle/steel-managed-shared"
import { request as httpRequest } from "node:http"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { FetchLike, Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js"
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"
import type { FastifyInstance } from "fastify"
import { afterEach, describe, expect, it } from "vitest"

import {
  MCP_RESULT_ID,
  NAVIGATE_ACTION,
  NAVIGATION_OUTPUT,
  PUBLIC_HOST,
  PUBLIC_ORIGIN,
  RESULT_ID,
  SequenceResultIdFactory,
  createTestServer,
} from "./managed-transport-test-support.js"

const openApps: FastifyInstance[] = []

class ExactOptionalTransport implements Transport {
  public onclose?: () => void
  public onerror?: (error: Error) => void
  public onmessage?: NonNullable<Transport["onmessage"]>

  public constructor(private readonly transport: StreamableHTTPClientTransport) {}

  public async start(): Promise<void> {
    if (this.onclose !== undefined) this.transport.onclose = this.onclose
    if (this.onerror !== undefined) this.transport.onerror = this.onerror
    if (this.onmessage !== undefined) this.transport.onmessage = this.onmessage
    await this.transport.start()
  }

  public async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    if (options === undefined) return this.transport.send(message)
    return this.transport.send(message, options)
  }

  public async close(): Promise<void> {
    await this.transport.close()
  }

  public setProtocolVersion(version: string): void {
    this.transport.setProtocolVersion(version)
  }
}

function createReverseProxyFetch(localOrigin: string): FetchLike {
  return async (input, init) => {
    const requested = new URL(input)
    const local = new URL(localOrigin)
    const headers = new Headers(init?.headers)
    headers.set("host", PUBLIC_HOST)
    headers.set("origin", PUBLIC_ORIGIN)
    const body = init?.body
    if (body !== undefined && body !== null && typeof body !== "string") {
      throw new TypeError("real-socket MCP fixture only supports string request bodies")
    }
    return new Promise<Response>((resolve, reject) => {
      const request = httpRequest({
        hostname: local.hostname,
        port: local.port,
        path: requested.pathname + requested.search,
        method: init?.method ?? "GET",
        headers: Object.fromEntries(headers.entries()),
      }, (response) => {
        const chunks: Buffer[] = []
        response.on("data", (chunk: Buffer) => chunks.push(chunk))
        response.once("error", reject)
        response.once("end", () => {
          if (response.statusCode === undefined) {
            reject(new TypeError("real-socket MCP fixture received no HTTP status"))
            return
          }
          const responseHeaders = new Headers()
          for (const [name, value] of Object.entries(response.headers)) {
            for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
              responseHeaders.append(name, entry)
            }
          }
          const responseInit: ResponseInit = response.statusMessage === undefined
            ? { status: response.statusCode, headers: responseHeaders }
            : { status: response.statusCode, statusText: response.statusMessage, headers: responseHeaders }
          resolve(new Response(Buffer.concat(chunks), responseInit))
        })
      })
      request.once("error", reject)
      request.end(body ?? undefined)
    })
  }
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()))
})

describe("managed AI real socket integration", () => {
  it("serves REST and the official MCP client through one TCP listener", async () => {
    const created = await createTestServer({
      resultIdFactory: new SequenceResultIdFactory([RESULT_ID, MCP_RESULT_ID]),
    })
    openApps.push(created.app)
    await created.app.listen({ host: "127.0.0.1", port: 0 })
    const address = created.app.server.address()
    if (address === null || typeof address === "string") throw new TypeError("TCP listener address is unavailable")
    const localOrigin = `http://127.0.0.1:${address.port}`

    const acceptedResponse = await fetch(localOrigin + "/v1/actions", {
      method: "POST",
      headers: { host: PUBLIC_HOST, "content-type": "application/json" },
      body: JSON.stringify(NAVIGATE_ACTION),
    })
    const accepted = AiActionAcceptedBodySchema.parse(await acceptedResponse.json())
    const completedResponse = await fetch(localOrigin + `/v1/results/${accepted.resultId}`, {
      headers: { host: PUBLIC_HOST, accept: "application/json" },
    })
    const completed: unknown = await completedResponse.json()

    expect(acceptedResponse.status).toBe(202)
    expect(acceptedResponse.headers.get("location")).toBe(`${PUBLIC_ORIGIN}/v1/results/${RESULT_ID}`)
    expect(accepted).toMatchObject({ resultId: RESULT_ID, state: AI_ASYNC_OUTCOME_STATE.ACCEPTED })
    expect(completedResponse.status).toBe(200)
    expect(completed).toMatchObject({ resultId: RESULT_ID, result: NAVIGATION_OUTPUT })

    const client = new Client({ name: "managed-real-socket-test", version: "1.0.0" })
    const transport = new ExactOptionalTransport(
      new StreamableHTTPClientTransport(new URL(localOrigin + "/mcp"), {
        fetch: createReverseProxyFetch(localOrigin),
      }),
    )
    await client.connect(transport)
    const catalog = await client.listTools()
    const call = await client.callTool({
      name: NAVIGATE_ACTION.tool.name,
      arguments: NAVIGATE_ACTION.arguments,
    })
    await client.close()

    expect(catalog.tools.map((tool) => tool.name)).toEqual(TOOL_NAMES)
    expect(call).toMatchObject({ isError: false, structuredContent: NAVIGATION_OUTPUT })
    expect(created.transport.gauges()).toMatchObject({
      action: { active: 0 },
      result: { retainedCount: 2, inFlightCount: 0 },
    })
  })
})
