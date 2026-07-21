import { z } from "zod"
import type { WorkerRegistry } from "../../registry/worker-registry.js"
import type { CompatibilityLifecycleRequest, CompatibilitySessionLifecycle } from "./compatibility-lifecycle.js"
import {
  MethodNotAllowedError,
  NoReachableWorkerError,
  RouteNotFoundError,
  mapPublicError,
} from "./error-mapper.js"
import {
  affinityForRoute,
  normalizeBoundaryError,
  reachableSessionListWorkers,
  reachableWorkers,
  rejectUnsupportedCreateField,
  requireSessionAffinity,
  rewriteGatewayResponse,
} from "./gateway-routing.js"
import { PublicRequestBodyTooLargeError, type WorkerRestProxy } from "./proxy.js"
import { PublicRouteMatchKind, matchPublicRoute } from "./routes.js"
import {
  PublicHttpMethod,
  PublicRouteId,
  type PublicGatewayResponse,
  type PublicRoute,
} from "./schemas.js"
import type { PublicRequestSecurity } from "./security.js"
import { aggregateSessionLists } from "./session-list-aggregator.js"
import { sanitizePublicStreamingHeaders } from "./response-safety.js"

type PublicRestRequest = CompatibilityLifecycleRequest & { readonly requestId: string }
type PublicRestGatewayOptions = {
  readonly lifecycle: CompatibilitySessionLifecycle
  readonly maxRequestBytes: number
  readonly proxy: WorkerRestProxy
  readonly registry: WorkerRegistry
  readonly security: PublicRequestSecurity
}

export class PublicRestGateway {
  private readonly maxRequestBytes: number

  public constructor(private readonly options: PublicRestGatewayOptions) {
    this.maxRequestBytes = z.number().int().min(1).max(16_777_216).parse(options.maxRequestBytes)
  }

  public async handle(input: PublicRestRequest): Promise<PublicGatewayResponse> {
    try {
      const { publicOrigin } = await this.options.security.authorize({ headers: input.headers })
      const match = matchPublicRoute(input.method, input.pathAndQuery)
      if (match.kind === PublicRouteMatchKind.NOT_FOUND) throw new RouteNotFoundError()
      if (match.kind === PublicRouteMatchKind.METHOD_NOT_ALLOWED) {
        throw new MethodNotAllowedError(match.allow)
      }
      if (input.body !== undefined && input.body.byteLength > this.maxRequestBytes) {
        throw new PublicRequestBodyTooLargeError()
      }
      rejectUnsupportedCreateField(match.route, input.body)
      return await this.dispatch(input, match.route, match.params, publicOrigin)
    } catch (error) {
      const normalized = error instanceof Error
        ? normalizeBoundaryError(error)
        : new Error("unknown public REST failure")
      return mapPublicError(normalized, input.requestId)
    }
  }

  public async close(): Promise<void> {
    await this.options.proxy.close()
  }

  private async dispatch(
    input: PublicRestRequest,
    route: PublicRoute,
    params: Readonly<Record<string, string>>,
    publicOrigin: string,
  ): Promise<PublicGatewayResponse> {
    if (route.id === PublicRouteId.SESSIONS_CREATE) {
      const result = await this.options.lifecycle.create(input)
      const worker = this.options.registry.workerForSession(result.session.publicSessionId)
      return rewriteGatewayResponse(
        input,
        route,
        publicOrigin,
        worker,
        result.response,
        result.session.publicSessionId,
      )
    }
    const affinity = affinityForRoute(
      route,
      params,
      input,
      this.options.registry.liveSessionIds(),
    )
    if (
      route.id === PublicRouteId.SESSIONS_RELEASE_ID ||
      route.id === PublicRouteId.SESSIONS_RELEASE_ACTIVE
    ) {
      const sessionId = requireSessionAffinity(affinity)
      const worker = this.options.registry.workerForSession(sessionId)
      const result = await this.options.lifecycle.release(sessionId, input)
      return rewriteGatewayResponse(
        input,
        route,
        publicOrigin,
        worker,
        result.response,
        result.session.publicSessionId,
      )
    }
    const workers = reachableWorkers(this.options.registry)
    if (route.id === PublicRouteId.SESSIONS_LIST) {
      if (workers.length === 0) throw new NoReachableWorkerError()
      return aggregateSessionLists({
        headers: input.headers,
        method: input.method,
        pathAndQuery: input.pathAndQuery,
        proxy: this.options.proxy,
        publicOrigin,
        signal: input.signal,
        workers: reachableSessionListWorkers(this.options.registry),
      })
    }
    const worker = affinity === undefined
      ? workers[0]
      : this.options.registry.workerForSession(affinity)
    if (worker === undefined) throw new NoReachableWorkerError()
    if (route.id === PublicRouteId.LOGS_STREAM && input.method === PublicHttpMethod.GET) {
      const response = await this.options.proxy.openStream({
        headers: input.headers,
        method: input.method,
        pathAndQuery: input.pathAndQuery,
        signal: input.signal,
        worker,
      })
      try {
        return {
          ...response,
          headers: sanitizePublicStreamingHeaders(response.headers, worker.origin),
        }
      } catch (error) {
        response.cancel()
        await response.closed
        throw error
      }
    }
    const response = await this.options.proxy.send({
      ...(input.body === undefined ? {} : { body: input.body }),
      headers: input.headers,
      method: input.method,
      pathAndQuery: input.pathAndQuery,
      signal: input.signal,
      worker,
    })
    return rewriteGatewayResponse(input, route, publicOrigin, worker, response, affinity)
  }
}
