import { z } from "zod"
import { resolveSessionAffinity } from "../../affinity/session-affinity.js"
import { assertNever } from "../../domain/exhaustive.js"
import { PublicSessionIdSchema, type PublicSessionId } from "../../domain/ids.js"
import { WorkerState } from "../../domain/states.js"
import type { WorkerDescriptor, WorkerRecord } from "../../registry/registry-model.js"
import type { WorkerRegistry } from "../../registry/worker-registry.js"
import type { CompatibilityLifecycleRequest } from "./compatibility-lifecycle.js"
import {
  InvalidArgumentError,
  UnsupportedFeature,
  UnsupportedFeatureError,
} from "./error-mapper.js"
import {
  PublicAffinity,
  PublicRouteId,
  type PublicHttpResponse,
  type PublicRoute,
} from "./schemas.js"
import type { SessionListWorker } from "./session-list-aggregator.js"
import { rewritePublicResponse } from "./url-rewriter.js"

const SESSION_ID_HEADER = "x-steel-session-id"
const SESSION_ID_QUERY = "sessionId"

class WorkerSelectionError extends Error {
  public override readonly name = "WorkerSelectionError"
}

export function rewriteGatewayResponse(
  input: CompatibilityLifecycleRequest,
  route: PublicRoute,
  publicOrigin: string,
  worker: WorkerDescriptor,
  response: PublicHttpResponse,
  sessionId?: PublicSessionId,
): PublicHttpResponse {
  return rewritePublicResponse({
    publicOrigin,
    requestMethod: input.method,
    routeId: route.id,
    ...(sessionId === undefined ? {} : { sessionId }),
    upstreamOrigin: worker.origin,
    response,
  })
}

export function affinityForRoute(
  route: PublicRoute,
  params: Readonly<Record<string, string>>,
  input: CompatibilityLifecycleRequest,
  liveSessions: readonly PublicSessionId[],
): PublicSessionId | undefined {
  if (route.affinity === PublicAffinity.CREATE || route.affinity === PublicAffinity.NONE) {
    return undefined
  }
  const url = new URL(input.pathAndQuery, "https://managed.invalid")
  const pathValue = params[SESSION_ID_QUERY] ?? params["id"]
  const path = route.affinity === PublicAffinity.PATH_SESSION_ID
    ? PublicSessionIdSchema.parse(pathValue)
    : undefined
  const headerValues = Object.entries(input.headers)
    .filter(([name]) => name.toLowerCase() === SESSION_ID_HEADER)
    .flatMap(([, value]) => value === undefined ? [] : [value])
  const queryValues = url.searchParams.getAll(SESSION_ID_QUERY)
  if (headerValues.length > 1 || queryValues.length > 1) throw new InvalidArgumentError()
  return resolveSessionAffinity({
    ...(path === undefined ? {} : { path }),
    ...(headerValues[0] === undefined ? {} : { header: PublicSessionIdSchema.parse(headerValues[0]) }),
    ...(queryValues[0] === undefined ? {} : { query: PublicSessionIdSchema.parse(queryValues[0]) }),
  }, liveSessions)
}

export function requireSessionAffinity(value: PublicSessionId | undefined): PublicSessionId {
  if (value === undefined) throw new WorkerSelectionError("session affinity was required")
  return value
}

export function reachableWorkers(registry: WorkerRegistry): readonly WorkerDescriptor[] {
  return registry.workers().flatMap((worker) => workerIsReachable(worker) ? [worker] : [])
}

export function reachableSessionListWorkers(
  registry: WorkerRegistry,
): readonly SessionListWorker[] {
  return registry.workers().flatMap((worker) => workerIsReachable(worker)
    ? [{
        worker,
        ...(worker.state === WorkerState.LIVE
          ? { expectedSessionId: worker.sessionId }
          : {}),
      }]
    : [])
}

function workerIsReachable(worker: WorkerRecord): boolean {
  switch (worker.state) {
    case WorkerState.IDLE:
    case WorkerState.RESERVED:
    case WorkerState.LIVE:
    case WorkerState.RELEASING:
    case WorkerState.RELEASE_UNCERTAIN:
      return true
    case WorkerState.RELEASE_UNCERTAIN_UNREACHABLE:
    case WorkerState.UNREACHABLE:
    case WorkerState.QUARANTINED:
      return false
    default:
      return assertNever(worker)
  }
}

export function rejectUnsupportedCreateField(route: PublicRoute, body: Buffer | undefined): void {
  if (route.id !== PublicRouteId.SESSIONS_CREATE || body === undefined || body.byteLength === 0) return
  const parsed: unknown = JSON.parse(body.toString("utf8"))
  if (typeof parsed === "object" && parsed !== null && "solveCaptcha" in parsed) {
    throw new UnsupportedFeatureError(UnsupportedFeature.SOLVE_CAPTCHA)
  }
}

export function normalizeBoundaryError(error: unknown): unknown {
  return error instanceof z.ZodError || error instanceof SyntaxError
    ? new InvalidArgumentError()
    : error
}
