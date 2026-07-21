import {
  MCP_PROTOCOL_VERSION,
  TOOL_NAMES,
  createManagedToolContracts,
  selectConfiguredPublicOrigin,
} from "@happycastle/steel-managed-shared"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import type { FastifyInstance } from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import {
  NAVIGATE_ACTION,
  NAVIGATION_OUTPUT,
  PUBLIC_HOST,
  PUBLIC_ORIGIN,
  SCREENSHOT_ACTION,
  SCREENSHOT_BYTES,
  SCREENSHOT_COMPLETION,
  TestExecutionPort,
  createTestServer,
  testConfig,
} from "./managed-transport-test-support.js"

const openApps: FastifyInstance[] = []
const commonHeaders = {
  host: PUBLIC_HOST,
  origin: PUBLIC_ORIGIN,
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  "mcp-protocol-version": MCP_PROTOCOL_VERSION,
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()))
})

async function server(input: Parameters<typeof createTestServer>[0] = {}) {
  const created = await createTestServer(input)
  openApps.push(created.app)
  return created
}

function rpc(method: string, id: string | number, params?: Readonly<Record<string, unknown>>) {
  return { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }
}

describe("official MCP Streamable HTTP transport", () => {
  it("rejects host/origin rebinding including a different configured public host", async () => {
    const candidateHost = "steel-candidate.soungmin.tech"
    const config = testConfig({
      allowedHosts: [PUBLIC_HOST, candidateHost],
      publicOriginByHost: {
        [PUBLIC_HOST]: PUBLIC_ORIGIN,
        [candidateHost]: `https://${candidateHost}`,
      },
    })
    const { app } = await server({ config })
    const crossHost = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { ...commonHeaders, host: candidateHost },
      payload: rpc("ping", 1),
    })
    const crossOrigin = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { ...commonHeaders, origin: `https://${candidateHost}` },
      payload: rpc("ping", 2),
    })

    expect(crossHost.statusCode).toBe(403)
    expect(crossOrigin.statusCode).toBe(403)
  })

  it("initializes statelessly at the pinned protocol revision", async () => {
    const { app } = await server()
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        host: PUBLIC_HOST,
        origin: PUBLIC_ORIGIN,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      payload: rpc("initialize", 1, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "integration-client", version: "1.0.0" },
      }),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      id: 1,
      result: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } } },
    })
    expect(response.headers["mcp-session-id"]).toBeUndefined()
  })

  it("lists all dynamic shared schemas and exact digests", async () => {
    const { app } = await server()
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: commonHeaders,
      payload: rpc("tools/list", 2, {}),
    })
    const config = testConfig()
    const expected = createManagedToolContracts({
      selectedOrigin: selectConfiguredPublicOrigin(PUBLIC_HOST, config),
      controlPlaneConfig: config,
    })
    const tools = response.json().result.tools

    expect(response.statusCode).toBe(200)
    expect(tools).toHaveLength(TOOL_NAMES.length)
    expect(tools.map((tool: Readonly<{ name: string }>) => tool.name)).toEqual(TOOL_NAMES)
    expect(tools.map((tool: Readonly<{ _meta: unknown }>) => tool._meta)).toEqual(
      expected.schemaDescriptors.map((tool) => ({
        inputSchemaSha256: tool.inputSchemaSha256,
        outputSchemaSha256: tool.outputSchemaSha256,
        version: tool.version,
      })),
    )
  })

  it("executes through the same retained service and returns structured output", async () => {
    const port = new TestExecutionPort()
    const { app, transport } = await server({ port })
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: commonHeaders,
      payload: rpc("tools/call", 3, {
        name: NAVIGATE_ACTION.tool.name,
        arguments: NAVIGATE_ACTION.arguments,
      }),
    })
    const result = CallToolResultSchema.parse(response.json().result)

    expect(result).toMatchObject({ isError: false, structuredContent: NAVIGATION_OUTPUT })
    expect(port.invocations[0]?.action).toEqual(NAVIGATE_ACTION)
    expect(transport.gauges().result.retainedCount).toBe(1)
  })

  it("encodes a validated retained screenshot as MCP image content", async () => {
    const port = new TestExecutionPort({ output: SCREENSHOT_COMPLETION, binaryBytes: SCREENSHOT_BYTES })
    const { app } = await server({ port })
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: commonHeaders,
      payload: rpc("tools/call", 4, {
        name: SCREENSHOT_ACTION.tool.name,
        arguments: SCREENSHOT_ACTION.arguments,
      }),
    })

    expect(response.json()).toMatchObject({
      id: 4,
      result: {
        isError: false,
        content: [{ type: "image", data: Buffer.from(SCREENSHOT_BYTES).toString("base64"), mimeType: "image/png" }],
      },
    })
  })

  it("returns tool input failures without invoking the execution port", async () => {
    const port = new TestExecutionPort()
    const { app } = await server({ port })
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: commonHeaders,
      payload: rpc("tools/call", 5, {
        name: NAVIGATE_ACTION.tool.name,
        arguments: { sessionId: "forged" },
      }),
    })

    expect(response.json()).toMatchObject({ id: 5, result: { isError: true } })
    expect(port.invocations).toEqual([])
  })

  it("rejects batches, stateful headers, and unsupported GET or DELETE", async () => {
    const { app } = await server()
    const batch = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: commonHeaders,
      payload: [rpc("ping", 1), rpc("ping", 2)],
    })
    const stateful = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { ...commonHeaders, "mcp-session-id": "forged" },
      payload: rpc("ping", 3),
    })
    const methodHeaders = { host: PUBLIC_HOST, origin: PUBLIC_ORIGIN }
    const get = await app.inject({ method: "GET", url: "/mcp", headers: methodHeaders })
    const remove = await app.inject({ method: "DELETE", url: "/mcp", headers: methodHeaders })

    expect(batch.statusCode).toBe(400)
    expect(stateful.statusCode).toBe(400)
    expect(get.statusCode).toBe(405)
    expect(remove.statusCode).toBe(405)
    expect(get.headers.allow).toBe("POST")
  })
})
