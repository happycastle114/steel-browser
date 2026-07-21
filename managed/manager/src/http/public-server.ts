import { randomUUID } from "node:crypto"
import {
  CONTROL_PLANE_API_VERSION,
  CONTROL_PLANE_FIXED,
  MANAGED_ERROR_CATALOG,
  MANAGED_ERROR_CODE,
  RETRY_POLICY_CAUSE,
  retryMetadataFor,
  type ManagedErrorCode,
} from "@happycastle/steel-managed-shared"
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify"
import type { ManagerConfig } from "../config.js"
import { AuthenticationError } from "../auth/jwt-authenticator.js"
import {
  ReservationCapacityError,
  type AtomicReservationLedger,
} from "../memory/atomic-reservation-ledger.js"
import {
  BodyTooLargeError,
  type ConnectionReservationRegistry,
  installConnectionGuard,
  installIngressBodyGuard,
  UnsupportedContentEncodingError,
} from "./ingress-guard.js"
import {
  RequestBoundaryError,
  RequestBoundaryFailure,
  type AuthorizedRequestContext,
  type RequestSecurity,
} from "./request-security.js"
import { AuthorizedRequestContextStore } from "./request-context-store.js"
import type { UiAssetManifest } from "../ui/asset-manifest.js"
import { registerStaticUi } from "../ui/static-ui.js"

const CORS_ALLOW_HEADERS = [
  "Authorization",
  "Cf-Access-Jwt-Assertion",
  "Content-Type",
  "Accept",
  "MCP-Protocol-Version",
  "Idempotency-Key",
] as const
const CORS_ALLOW_METHODS = ["GET", "HEAD", "POST", "DELETE", "OPTIONS"] as const
const MAX_HEADER_COUNT = 64
const MAX_REQUESTS_PER_SOCKET = 100

export type PublicServerOptions = {
  readonly bodyLedger: AtomicReservationLedger
  readonly compatibilityHealth: Readonly<{ read: () => Promise<Readonly<Record<string, unknown>>> }>
  readonly config: ManagerConfig
  readonly connectionLedger: AtomicReservationLedger
  readonly onConnectionRejected: () => void
  readonly requestSecurity: RequestSecurity
  readonly requestContexts: AuthorizedRequestContextStore
  readonly registerRoutes?: (app: FastifyInstance) => Promise<void> | void
  readonly uiAssets: Readonly<{ manifest: UiAssetManifest; root: string }>
}

export type PublicServerRuntime = Readonly<{
  app: FastifyInstance
  connectionReservations: ConnectionReservationRegistry
}>

export function buildPublicServer(options: PublicServerOptions): FastifyInstance {
  return buildPublicServerRuntime(options).app
}

export function buildPublicServerRuntime(options: PublicServerOptions): PublicServerRuntime {
  const controlPlane = options.config.controlPlane
  const app = Fastify({
    bodyLimit: controlPlane.httpBodyBytes,
    connectionTimeout: CONTROL_PLANE_FIXED.httpBodyTimeoutMs,
    genReqId: () => randomUUID(),
    http: { maxHeaderSize: CONTROL_PLANE_FIXED.httpHeaderBytes },
    keepAliveTimeout: CONTROL_PLANE_FIXED.httpKeepAliveMs,
    logger: false,
    requestTimeout: controlPlane.httpRequestTimeoutMs,
  })
  app.server.headersTimeout = CONTROL_PLANE_FIXED.httpHeadersTimeoutMs
  app.server.keepAliveTimeout = CONTROL_PLANE_FIXED.httpKeepAliveMs
  app.server.maxHeadersCount = MAX_HEADER_COUNT
  app.server.maxRequestsPerSocket = MAX_REQUESTS_PER_SOCKET
  app.server.requestTimeout = controlPlane.httpRequestTimeoutMs
  const connectionReservations = installConnectionGuard(app.server, {
    ledger: options.connectionLedger,
    onRejected: options.onConnectionRejected,
    reservationBytes: controlPlane.memory.httpConnectionReservationBytes,
  })

  app.addHook("onRequest", async (request) => {
    options.requestContexts.set(
      request.raw,
      await options.requestSecurity.authorize(request.headers),
    )
  })
  installIngressBodyGuard(app, {
    bodyLimitBytes: controlPlane.httpBodyBytes,
    bodyTimeoutMilliseconds: CONTROL_PLANE_FIXED.httpBodyTimeoutMs,
    ledger: options.bodyLedger,
    reservationBytes: controlPlane.memory.httpBodyReservationBytes,
  })
  app.addHook("onSend", async (request, reply, payload) => {
    applySecurityHeaders(reply)
    let context: AuthorizedRequestContext | undefined
    try {
      context = options.requestContexts.require(request.raw)
    } catch {
      context = undefined
    }
    if (context !== undefined && request.headers.origin !== undefined) {
      applyCorsHeaders(reply, context.publicOrigin)
    }
    return payload
  })
  app.setErrorHandler((error, request, reply) => sendBoundaryError(error, request, reply, controlPlane.reconcileMs))
  app.get("/v1/health", async () => options.compatibilityHealth.read())
  if (options.registerRoutes !== undefined) {
    app.register(async (scope) => options.registerRoutes?.(scope))
  }
  registerStaticUi(app, options.uiAssets)
  app.options("/*", async (_request, reply) => reply.code(204).send())
  app.setNotFoundHandler(async (_request, reply) => {
    await sendManagedError(reply, _request.id, MANAGED_ERROR_CODE.ROUTE_NOT_FOUND)
  })
  return { app, connectionReservations }
}

function applyCorsHeaders(reply: FastifyReply, origin: string): void {
  reply.header("access-control-allow-credentials", "true")
  reply.header("access-control-allow-headers", CORS_ALLOW_HEADERS.join(", "))
  reply.header("access-control-allow-methods", CORS_ALLOW_METHODS.join(", "))
  reply.header("access-control-allow-origin", origin)
  reply.header("vary", "Origin")
}

function applySecurityHeaders(reply: FastifyReply): void {
  reply.header(
    "content-security-policy",
    "default-src 'self'; frame-ancestors 'none'; frame-src 'self'; object-src 'none'; base-uri 'none'",
  )
  reply.header("referrer-policy", "no-referrer")
  reply.header("strict-transport-security", "max-age=31536000; includeSubDomains")
  reply.header("x-content-type-options", "nosniff")
  reply.header("x-frame-options", "DENY")
}

async function sendBoundaryError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
  reconcileMilliseconds: number,
): Promise<void> {
  if (error instanceof RequestBoundaryError) {
    const status =
      error.code === RequestBoundaryFailure.HOST_REJECTED ? 421 : 403
    await sendManagedError(reply, request.id, MANAGED_ERROR_CODE.ACCESS_FORBIDDEN, status)
    return
  }
  if (error instanceof AuthenticationError) {
    await sendManagedError(reply, request.id, MANAGED_ERROR_CODE.ACCESS_AUTH_REQUIRED)
    return
  }
  if (error instanceof ReservationCapacityError) {
    const retry = retryMetadataFor({
      cause: RETRY_POLICY_CAUSE.INGRESS_CAPACITY,
      reconcileMs: reconcileMilliseconds,
    })
    reply.header("retry-after", retry.headers["Retry-After"])
    await sendManagedError(
      reply,
      request.id,
      MANAGED_ERROR_CODE.MANAGED_INGRESS_CAPACITY,
      undefined,
      retry.details,
    )
    return
  }
  if (error instanceof BodyTooLargeError) {
    await sendManagedError(reply, request.id, MANAGED_ERROR_CODE.BODY_TOO_LARGE)
    return
  }
  if (error instanceof UnsupportedContentEncodingError) {
    await sendManagedError(reply, request.id, MANAGED_ERROR_CODE.UNSUPPORTED_MEDIA_TYPE)
    return
  }
  await reply.code(500).send({ error: { code: "INTERNAL" } })
}

async function sendManagedError(
  reply: FastifyReply,
  requestId: string,
  code: ManagedErrorCode,
  statusOverride?: number,
  details?: Readonly<Record<string, number>>,
): Promise<void> {
  const catalog = MANAGED_ERROR_CATALOG[code]
  await reply.code(statusOverride ?? catalog.status).send({
    apiVersion: CONTROL_PLANE_API_VERSION,
    error: {
      code,
      message: "request rejected",
      retryable: catalog.retryable,
      requestId,
      ...(details === undefined ? {} : { details }),
    },
  })
}
