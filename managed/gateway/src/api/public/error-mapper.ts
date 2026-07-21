import {
  AdmissionBackpressureError,
  AmbiguousSessionAffinityError,
  NoLiveSessionError,
  SessionNotFoundError,
  StaleWorkerGenerationError,
  WorkerAdapterError,
  WorkerIdentityMismatchError,
} from "../../domain/errors.js"
import { PublicResponseRewriteError } from "./url-rewriter.js"
import {
  WorkerRestAbortedError,
  WorkerRestBadResponseError,
  WorkerRestTimeoutError,
  PublicRequestBodyTooLargeError,
} from "./proxy.js"
import {
  AccessAuthenticationError,
  PublicHostError,
  PublicOriginError,
} from "./security.js"
import {
  MANAGED_API_VERSION,
  type PublicHttpMethod,
  type PublicHttpResponse,
} from "./schemas.js"

export const PublicErrorCode = {
  ACCESS_AUTH_REQUIRED: "ACCESS_AUTH_REQUIRED",
  ACCESS_FORBIDDEN: "ACCESS_FORBIDDEN",
  ADMISSION_NOT_FOUND: "ADMISSION_NOT_FOUND",
  BODY_TOO_LARGE: "BODY_TOO_LARGE",
  INSTANCE_LOST: "INSTANCE_LOST",
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  MANAGED_FEATURE_UNSUPPORTED: "MANAGED_FEATURE_UNSUPPORTED",
  MANAGED_SESSION_REQUIRED: "MANAGED_SESSION_REQUIRED",
  MANAGED_WS_CAPACITY: "MANAGED_WS_CAPACITY",
  METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
  NO_REACHABLE_WORKER: "NO_REACHABLE_WORKER",
  QUEUE_FULL: "QUEUE_FULL",
  RESULT_NOT_FOUND: "RESULT_NOT_FOUND",
  ROUTE_NOT_FOUND: "ROUTE_NOT_FOUND",
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  UPSTREAM_BAD_RESPONSE: "UPSTREAM_BAD_RESPONSE",
  UPSTREAM_TIMEOUT: "UPSTREAM_TIMEOUT",
} as const
export type PublicErrorCode = (typeof PublicErrorCode)[keyof typeof PublicErrorCode]

export class MethodNotAllowedError extends Error {
  public override readonly name = "MethodNotAllowedError"

  public constructor(public readonly allow: readonly PublicHttpMethod[]) {
    super("method not allowed")
  }
}

export const UnsupportedFeature = { SOLVE_CAPTCHA: "solveCaptcha" } as const
export type UnsupportedFeature = (typeof UnsupportedFeature)[keyof typeof UnsupportedFeature]

export class UnsupportedFeatureError extends Error {
  public override readonly name = "UnsupportedFeatureError"

  public constructor(public readonly feature: UnsupportedFeature) {
    super("unsupported compatibility feature")
  }
}

export class RouteNotFoundError extends Error {
  public override readonly name = "RouteNotFoundError"
}

export class NoReachableWorkerError extends Error {
  public override readonly name = "NoReachableWorkerError"
}

export class InvalidArgumentError extends Error {
  public override readonly name = "InvalidArgumentError"
}

export class ManagedWebSocketCapacityError extends Error {
  public override readonly name = "ManagedWebSocketCapacityError"

  public constructor(public readonly retryAfterSeconds: number) {
    super("managed websocket capacity is exhausted")
  }
}

type ErrorDefinition = {
  readonly code: PublicErrorCode
  readonly details?: Readonly<Record<string, unknown>>
  readonly headers?: Readonly<Record<string, string>>
  readonly message: string
  readonly retryable: boolean
  readonly statusCode: number
}

export function mapPublicError(error: unknown, requestId: string): PublicHttpResponse {
  return errorResponse(definitionFor(error), requestId)
}

function definitionFor(error: unknown): ErrorDefinition {
  const C = PublicErrorCode
  if (error instanceof SessionNotFoundError) {
    return definition(C.SESSION_NOT_FOUND, 404, "Session was not found.", false)
  }
  if (error instanceof AmbiguousSessionAffinityError || error instanceof NoLiveSessionError) {
    return definition(C.MANAGED_SESSION_REQUIRED, 409, "An explicit session is required.", false)
  }
  if (error instanceof WorkerIdentityMismatchError || error instanceof StaleWorkerGenerationError) {
    return definition(C.INSTANCE_LOST, 410, "The browser instance is no longer available.", false)
  }
  if (error instanceof WorkerRestTimeoutError || error instanceof WorkerRestAbortedError) {
    return definition(C.UPSTREAM_TIMEOUT, 504, "The browser request timed out.", true)
  }
  if (error instanceof PublicRequestBodyTooLargeError) {
    return definition(C.BODY_TOO_LARGE, 413, "Request body is too large.", false)
  }
  if (error instanceof MethodNotAllowedError) {
    return {
      ...definition(C.METHOD_NOT_ALLOWED, 405, "Method is not allowed.", false),
      headers: { allow: error.allow.join(", ") },
    }
  }
  if (error instanceof UnsupportedFeatureError) {
    return {
      ...definition(
        C.MANAGED_FEATURE_UNSUPPORTED,
        422,
        "This compatibility feature is unavailable.",
        false,
      ),
      details: { capabilityUrl: "/v1/capabilities", feature: error.feature },
    }
  }
  if (error instanceof AccessAuthenticationError) {
    return definition(C.ACCESS_AUTH_REQUIRED, 401, "Authentication is required.", false)
  }
  if (error instanceof PublicOriginError) {
    return definition(C.ACCESS_FORBIDDEN, 403, "Access is forbidden.", false)
  }
  if (error instanceof PublicHostError || error instanceof InvalidArgumentError) {
    return definition(C.INVALID_ARGUMENT, 400, "The request is invalid.", false)
  }
  if (error instanceof RouteNotFoundError) {
    return definition(C.ROUTE_NOT_FOUND, 404, "Route was not found.", false)
  }
  if (error instanceof NoReachableWorkerError) {
    return definition(C.NO_REACHABLE_WORKER, 503, "No browser worker is reachable.", true)
  }
  if (error instanceof AdmissionBackpressureError) {
    return definition(C.QUEUE_FULL, 429, "Admission queue is full.", true)
  }
  if (error instanceof ManagedWebSocketCapacityError) {
    return {
      ...definition(C.MANAGED_WS_CAPACITY, 503, "WebSocket capacity is exhausted.", true),
      details: { retryAfterSeconds: error.retryAfterSeconds },
      headers: { "retry-after": String(error.retryAfterSeconds) },
    }
  }
  if (
    error instanceof WorkerRestBadResponseError ||
    error instanceof WorkerAdapterError ||
    error instanceof PublicResponseRewriteError
  ) {
    return definition(C.UPSTREAM_BAD_RESPONSE, 502, "The browser response was invalid.", true)
  }
  return definition(C.UPSTREAM_BAD_RESPONSE, 502, "The browser response was invalid.", true)
}

function definition(
  code: PublicErrorCode,
  statusCode: number,
  message: string,
  retryable: boolean,
): ErrorDefinition {
  return { code, message, retryable, statusCode }
}

function errorResponse(definition: ErrorDefinition, requestId: string): PublicHttpResponse {
  const error = definition.details === undefined
    ? {
        code: definition.code,
        message: definition.message,
        retryable: definition.retryable,
        requestId,
      }
    : {
        code: definition.code,
        message: definition.message,
        retryable: definition.retryable,
        requestId,
        details: definition.details,
      }
  return {
    statusCode: definition.statusCode,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-managed-api-version": MANAGED_API_VERSION,
      ...definition.headers,
    },
    body: Buffer.from(JSON.stringify({ apiVersion: MANAGED_API_VERSION, error })),
  }
}
