import {
  CONTROL_PLANE_API_VERSION,
  CONTROL_PLANE_SERVICE_NAME,
  MANAGED_ERROR_CODE,
  TOOL_VERSION,
  ToolNameSchema,
  canonicalJson,
} from "@happycastle/steel-managed-shared"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import { assertNever } from "../domain/exhaustive.js"
import type { AiBrowserService } from "../api/managed/action-service.js"
import type { ManagedRequestIdentity } from "../api/managed/execution-contract.js"
import { COMPLETED_ACTION_KIND, type CompletedAction } from "../api/managed/service-contract.js"
import { ManagedTransportError } from "../api/managed/transport-error.js"
import type { McpToolDescriptor } from "./catalog.js"

type McpServerContext = Readonly<{
  readonly identity: ManagedRequestIdentity
  readonly serviceVersion: string
  readonly tools: readonly McpToolDescriptor[]
}>

const StructuredContentSchema = z.record(z.unknown())

export function createManagedMcpServer(service: AiBrowserService, context: McpServerContext): Server {
  const server = new Server(
    { name: CONTROL_PLANE_SERVICE_NAME, version: context.serviceVersion },
    { capabilities: { tools: { listChanged: false } } },
  )
  server.setRequestHandler(ListToolsRequestSchema, (request) => {
    if (request.params?.cursor !== undefined) throw new McpError(ErrorCode.InvalidParams, "Pagination cursor is not supported")
    return { tools: context.tools.map((tool) => ({ ...tool })) }
  })
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const toolName = ToolNameSchema.safeParse(request.params.name)
    if (!toolName.success) {
      return toolError(new ManagedTransportError(MANAGED_ERROR_CODE.TOOL_INPUT_INVALID, "Unknown tool"))
    }
    try {
      const accepted = service.submit({
        action: {
          apiVersion: CONTROL_PLANE_API_VERSION,
          tool: { name: toolName.data, version: TOOL_VERSION },
          arguments: request.params.arguments ?? {},
        },
        ...context.identity,
        signal: extra.signal,
      })
      const completed = await service.waitForResult({
        resultId: accepted.body.resultId,
        ...context.identity,
      })
      return toolResult(completed)
    } catch (error) {
      if (error instanceof ManagedTransportError) return toolError(error)
      throw new McpError(ErrorCode.InternalError, "Tool execution failed")
    }
  })
  return server
}

function toolError(error: ManagedTransportError): CallToolResult {
  return {
    content: [{ type: "text", text: error.message }],
    isError: true,
    structuredContent: { error: { code: error.code, message: error.message } },
  }
}

function toolResult(completed: CompletedAction): CallToolResult {
  const structuredContent = StructuredContentSchema.safeParse(completed.output)
  if (!structuredContent.success) throw new McpError(ErrorCode.InternalError, "Tool output was not structured")
  switch (completed.kind) {
    case COMPLETED_ACTION_KIND.JSON:
      return {
        content: [{ type: "text", text: canonicalJson(completed.output) }],
        structuredContent: structuredContent.data,
        isError: false,
      }
    case COMPLETED_ACTION_KIND.BINARY:
      return {
        content: [{
          type: "image",
          data: Buffer.from(completed.bytes).toString("base64"),
          mimeType: completed.contentType,
        }],
        structuredContent: structuredContent.data,
        isError: false,
      }
    default:
      return assertNever(completed)
  }
}
