import { MCP_PROTOCOL_VERSION, type SelectedPublicOrigin } from "@happycastle/steel-managed-shared"
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js"
import type { FastifyRequest } from "fastify"
import { McpHttpError } from "./transport-error.js"

export const MCP_RESPONSE_MEDIA = { JSON: "JSON", SSE: "SSE" } as const
export type McpResponseMedia = (typeof MCP_RESPONSE_MEDIA)[keyof typeof MCP_RESPONSE_MEDIA]

export function requireMcpConnectionSecurity(
  request: FastifyRequest,
  selectedOrigin: SelectedPublicOrigin,
): void {
  const expectedHost = new URL(selectedOrigin).host.toLowerCase()
  const host = request.headers.host?.toLowerCase()
  const origin = request.headers.origin
  if (host !== expectedHost || (origin !== undefined && origin !== selectedOrigin)) {
    throw new McpHttpError(403, ErrorCode.InvalidRequest, "Forbidden connection origin")
  }
}

export function mcpAllowedHosts(selectedOrigin: SelectedPublicOrigin): readonly string[] {
  return Object.freeze([new URL(selectedOrigin).host.toLowerCase()])
}

export function requireMcpJsonContentType(contentType: string | undefined): void {
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase()
  if (mediaType !== "application/json") {
    throw new McpHttpError(415, ErrorCode.InvalidRequest, "Content-Type must be application/json")
  }
}

export function negotiateMcpResponse(accept: string | undefined): McpResponseMedia {
  const jsonWeight = mediaWeight(accept, "application/json")
  const sseWeight = mediaWeight(accept, "text/event-stream")
  if (jsonWeight <= 0 || sseWeight <= 0) {
    throw new McpHttpError(406, ErrorCode.InvalidRequest, "Accept must include application/json and text/event-stream")
  }
  return sseWeight > jsonWeight ? MCP_RESPONSE_MEDIA.SSE : MCP_RESPONSE_MEDIA.JSON
}

export function requireMcpProtocolVersion(request: FastifyRequest, allowsMissing: boolean): void {
  const version = request.headers["mcp-protocol-version"]
  if (version === undefined && allowsMissing) return
  if (version !== MCP_PROTOCOL_VERSION) {
    throw new McpHttpError(400, ErrorCode.InvalidParams, "Unsupported MCP protocol version")
  }
}

function mediaWeight(header: string | undefined, mediaType: string): number {
  if (header === undefined) return 0
  for (const entry of header.split(",")) {
    const [name, ...parameters] = entry.trim().toLowerCase().split(";")
    if (name !== mediaType) continue
    const quality = parameters.find((parameter) => parameter.trim().startsWith("q="))
    if (quality === undefined) return 1
    const value = Number(quality.trim().slice(2))
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0
  }
  return 0
}
