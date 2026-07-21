import { randomUUID } from "node:crypto"

import { UuidV4Schema } from "@happycastle/steel-managed-shared"
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js"
import type { FastifyReply } from "fastify"
import type { RequestContext } from "../api/managed/execution-contract.js"

export class McpHttpError extends Error {
  public override readonly name = "McpHttpError"

  public constructor(
    public readonly statusCode: number,
    public readonly rpcCode: number,
    message: string,
  ) {
    super(message)
  }
}

export function sendMcpHttpError(reply: FastifyReply, context: RequestContext | undefined, error: McpHttpError): void {
  const safeContext = context ?? {
    requestId: UuidV4Schema.parse(randomUUID()),
    correlationId: UuidV4Schema.parse(randomUUID()),
  }
  reply
    .header("x-request-id", safeContext.requestId)
    .header("x-correlation-id", safeContext.correlationId)
    .code(error.statusCode)
    .send({ jsonrpc: "2.0", id: null, error: { code: error.rpcCode, message: error.message } })
}

export function translateFastifyMcpError(error: unknown): McpHttpError {
  const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined
  if (code === "FST_ERR_CTP_BODY_TOO_LARGE") return new McpHttpError(413, ErrorCode.InvalidRequest, "Request body exceeds the configured limit")
  if (code === "FST_ERR_CTP_INVALID_JSON_BODY") return new McpHttpError(400, ErrorCode.ParseError, "Parse error")
  return new McpHttpError(500, ErrorCode.InternalError, "Internal error")
}
