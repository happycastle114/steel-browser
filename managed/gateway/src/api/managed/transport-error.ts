import {
  CONTROL_PLANE_API_VERSION,
  MANAGED_ERROR_CATALOG,
  MANAGED_ERROR_CODE,
  ManagedErrorEnvelopeSchema,
  type JsonValue,
  type ManagedErrorCode,
} from "@happycastle/steel-managed-shared"
import type { FastifyReply } from "fastify"
import type { RequestContext } from "./execution-contract.js"

export type ManagedTransportErrorOptions = Readonly<{
  readonly details?: JsonValue
  readonly retryAfterSeconds?: number
}>

export class ManagedTransportError extends Error {
  public override readonly name = "ManagedTransportError"

  public constructor(
    public readonly code: ManagedErrorCode,
    message: string,
    options: ManagedTransportErrorOptions = {},
  ) {
    super(message)
    if (options.retryAfterSeconds !== undefined &&
      (!Number.isSafeInteger(options.retryAfterSeconds) || options.retryAfterSeconds < 1)) {
      throw new RangeError("Retry-After must be a positive safe integer")
    }
    this.details = options.details
    this.retryAfterSeconds = options.retryAfterSeconds
  }

  public readonly details: JsonValue | undefined
  public readonly retryAfterSeconds: number | undefined
}

export function requireJsonContentType(contentType: string | undefined): void {
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase()
  if (mediaType !== "application/json") {
    throw new ManagedTransportError(
      MANAGED_ERROR_CODE.UNSUPPORTED_MEDIA_TYPE,
      "Content-Type must be application/json",
    )
  }
}

export function sendManagedError(
  reply: FastifyReply,
  context: RequestContext,
  error: ManagedTransportError,
): void {
  const catalog = MANAGED_ERROR_CATALOG[error.code]
  const envelope = ManagedErrorEnvelopeSchema.parse({
    apiVersion: CONTROL_PLANE_API_VERSION,
    error: {
      code: error.code,
      message: error.message,
      retryable: catalog.retryable,
      requestId: context.requestId,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  })
  reply
    .header("x-request-id", context.requestId)
    .header("x-correlation-id", context.correlationId)
  if (error.retryAfterSeconds !== undefined) {
    reply.header("retry-after", String(error.retryAfterSeconds))
  }
  reply
    .code(catalog.status)
    .send(envelope)
}

export function translateFastifyError(error: unknown): ManagedTransportError {
  const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined
  if (code === "FST_ERR_CTP_BODY_TOO_LARGE") {
    return new ManagedTransportError(MANAGED_ERROR_CODE.BODY_TOO_LARGE, "Request body exceeds the configured limit")
  }
  if (code === "FST_ERR_CTP_INVALID_JSON_BODY") {
    return new ManagedTransportError(MANAGED_ERROR_CODE.INVALID_ARGUMENT, "Request body must be valid JSON")
  }
  return new ManagedTransportError(MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE, "The managed transport failed")
}
