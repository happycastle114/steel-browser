import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import {
  MANAGED_ERROR_CATALOG,
  MANAGED_ERROR_CODE,
  MCP_PROTOCOL_VERSION,
  type ControlPlaneConfig,
} from "@happycastle/steel-managed-shared"
import { ErrorCode, JSONRPCMessageSchema, isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { AiBrowserService } from "../api/managed/action-service.js"
import type { ManagedRequestIdentityProvider, RequestContext } from "../api/managed/execution-contract.js"
import { ManagedTransportError } from "../api/managed/transport-error.js"
import { createManagedAiContracts } from "../api/managed/transport-config.js"
import { createMcpToolCatalog } from "./catalog.js"
import { createManagedMcpServer } from "./handler.js"
import { SdkTransportAdapter } from "./sdk-transport-adapter.js"
import {
  MCP_RESPONSE_MEDIA,
  mcpAllowedHosts,
  negotiateMcpResponse,
  requireMcpConnectionSecurity,
  requireMcpJsonContentType,
  requireMcpProtocolVersion,
} from "./security.js"
import { McpHttpError, sendMcpHttpError } from "./transport-error.js"

export type McpRouteDependencies = Readonly<{
  readonly service: AiBrowserService
  readonly requestIdentity: ManagedRequestIdentityProvider
  readonly config: ControlPlaneConfig
  readonly serviceVersion: string
}>

export function registerMcpRoutes(app: FastifyInstance, dependencies: McpRouteDependencies): void {
  app.route({
    method: ["GET", "DELETE"],
    url: "/mcp",
    handler: async (request, reply) => {
      const identity = await dependencies.requestIdentity(request)
      try {
        requireMcpConnectionSecurity(request, identity.selectedOrigin)
        reply
          .header("allow", "POST")
          .header("x-request-id", identity.context.requestId)
          .header("x-correlation-id", identity.context.correlationId)
          .code(405)
          .send()
      } catch (error) {
        sendRouteError(reply, identity.context, error)
      }
    },
  })

  app.post("/mcp", async (request, reply) => {
    const identity = await dependencies.requestIdentity(request)
    try {
      requireMcpConnectionSecurity(request, identity.selectedOrigin)
      requireMcpJsonContentType(request.headers["content-type"])
      const media = negotiateMcpResponse(request.headers.accept)
      requireSingleMcpMessage(request.body)
      const initializing = requireInitializeProtocol(request.body)
      requireMcpProtocolVersion(request, initializing)
      requireStatelessHeaders(request)
      const contracts = createManagedAiContracts({
        config: dependencies.config,
        selectedOrigin: identity.selectedOrigin,
        serviceVersion: dependencies.serviceVersion,
      })
      const server = createManagedMcpServer(dependencies.service, {
        identity,
        serviceVersion: contracts.serviceVersion,
        tools: createMcpToolCatalog(contracts.schemaDescriptors),
      })
      const transport = new StreamableHTTPServerTransport({
        enableJsonResponse: media === MCP_RESPONSE_MEDIA.JSON,
        enableDnsRebindingProtection: true,
        allowedHosts: [...mcpAllowedHosts(identity.selectedOrigin)],
        allowedOrigins: [identity.selectedOrigin],
      })
      await server.connect(new SdkTransportAdapter(transport))
      scheduleClose(reply, server)
      reply.raw.setHeader("x-request-id", identity.context.requestId)
      reply.raw.setHeader("x-correlation-id", identity.context.correlationId)
      reply.hijack()
      await transport.handleRequest(request.raw, reply.raw, request.body)
    } catch (error) {
      if (reply.raw.headersSent) {
        if (!reply.raw.writableEnded) reply.raw.end()
        return
      }
      sendRouteError(reply, identity.context, error)
    }
  })
}

export function isMcpEndpoint(request: FastifyRequest): boolean {
  return request.url.split("?", 1)[0] === "/mcp"
}

function requireSingleMcpMessage(body: unknown): void {
  if (Array.isArray(body)) throw new McpHttpError(400, ErrorCode.InvalidRequest, "JSON-RPC batches are not supported")
  if (!JSONRPCMessageSchema.safeParse(body).success) throw new McpHttpError(400, ErrorCode.InvalidRequest, "Invalid Request")
}

function requireInitializeProtocol(body: unknown): boolean {
  if (!isInitializeRequest(body)) return false
  if (body.params.protocolVersion !== MCP_PROTOCOL_VERSION) {
    throw new McpHttpError(400, ErrorCode.InvalidParams, "Unsupported initialize protocol version")
  }
  return true
}

function requireStatelessHeaders(request: FastifyRequest): void {
  if (request.headers["mcp-session-id"] !== undefined) {
    throw new McpHttpError(400, ErrorCode.InvalidRequest, "MCP sessions are not enabled")
  }
}

function scheduleClose(reply: FastifyReply, server: ReturnType<typeof createManagedMcpServer>): void {
  let closing = false
  const close = (): void => {
    if (closing) return
    closing = true
    void server.close().catch(() => undefined)
  }
  reply.raw.once("finish", close)
  reply.raw.once("close", close)
}

function sendRouteError(reply: FastifyReply, context: RequestContext, error: unknown): void {
  const translated = error instanceof McpHttpError
    ? error
    : error instanceof ManagedTransportError
      ? new McpHttpError(
        MANAGED_ERROR_CATALOG[error.code].status,
        error.code === MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE ? ErrorCode.InternalError : ErrorCode.InvalidRequest,
        error.message,
      )
      : new McpHttpError(500, ErrorCode.InternalError, "Internal error")
  sendMcpHttpError(reply, context, translated)
}
