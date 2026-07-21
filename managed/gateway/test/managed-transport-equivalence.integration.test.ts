import { MCP_PROTOCOL_VERSION } from "@happycastle/steel-managed-shared"
import type { FastifyInstance } from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import {
  NAVIGATE_ACTION,
  NAVIGATION_OUTPUT,
  PUBLIC_HOST,
  PUBLIC_ORIGIN,
  RESULT_ID,
  TestExecutionPort,
  createTestServer,
} from "./managed-transport-test-support.js"

const openApps: FastifyInstance[] = []

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()))
})

describe("managed REST and MCP execution equivalence", () => {
  it("returns the same validated result through both real HTTP surfaces", async () => {
    const restPort = new TestExecutionPort()
    const mcpPort = new TestExecutionPort()
    const rest = await createTestServer({ port: restPort })
    const mcp = await createTestServer({ port: mcpPort })
    openApps.push(rest.app, mcp.app)
    const accepted = await rest.app.inject({
      method: "POST",
      url: "/v1/actions",
      headers: { host: PUBLIC_HOST, "content-type": "application/json" },
      payload: NAVIGATE_ACTION,
    })
    const retained = await rest.app.inject({
      method: "GET",
      url: `/v1/results/${RESULT_ID}`,
      headers: { host: PUBLIC_HOST },
    })
    const toolCall = await mcp.app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        host: PUBLIC_HOST,
        origin: PUBLIC_ORIGIN,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": MCP_PROTOCOL_VERSION,
      },
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: NAVIGATE_ACTION.tool.name, arguments: NAVIGATE_ACTION.arguments },
      },
    })

    expect(accepted.statusCode).toBe(202)
    expect(retained.json().result).toEqual(NAVIGATION_OUTPUT)
    expect(toolCall.json().result.structuredContent).toEqual(NAVIGATION_OUTPUT)
    expect(restPort.invocations[0]?.action).toEqual(mcpPort.invocations[0]?.action)
  })
})
