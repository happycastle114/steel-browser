import { z } from "zod"
import {
  AFFINITY_RULE,
  LIFECYCLE_CLASS,
  WEBSOCKET_UPGRADE_CLASS,
} from "@happycastle/steel-managed-shared"
import { resolveSessionAffinity } from "../affinity/session-affinity.js"
import { canonicalPublicPathname } from "../api/public/path-validation.js"
import { PublicSessionIdSchema, type PublicSessionId } from "../domain/ids.js"
import type { WorkerDescriptor } from "../registry/registry-model.js"
import type { WorkerRegistry } from "../registry/worker-registry.js"

export const ManagedWebSocketRouteId = {
  CAST: "ws.cast",
  CDP: "ws.root-cdp",
  LOGS: "ws.logs",
  PAGE_ID: "ws.page-id",
  RECORDING: "ws.recording",
} as const
export type ManagedWebSocketRouteId =
  (typeof ManagedWebSocketRouteId)[keyof typeof ManagedWebSocketRouteId]

export const PUBLIC_WEBSOCKET_ROUTES = [
  {
    id: ManagedWebSocketRouteId.CAST,
    path: "/v1/sessions/cast",
    affinity: AFFINITY_RULE.UNSCOPED_ACTIVE_SESSION,
    lifecycle: LIFECYCLE_CLASS.WEBSOCKET,
    upgradeClass: WEBSOCKET_UPGRADE_CLASS.CAST,
    expectedCloseCodes: [1000],
  },
  {
    id: ManagedWebSocketRouteId.LOGS,
    path: "/v1/sessions/logs",
    affinity: AFFINITY_RULE.UNSCOPED_ACTIVE_SESSION,
    lifecycle: LIFECYCLE_CLASS.WEBSOCKET,
    upgradeClass: WEBSOCKET_UPGRADE_CLASS.LOGS,
    expectedCloseCodes: [1000],
  },
  {
    id: ManagedWebSocketRouteId.PAGE_ID,
    path: "/v1/sessions/pageId",
    affinity: AFFINITY_RULE.UNSCOPED_ACTIVE_SESSION,
    lifecycle: LIFECYCLE_CLASS.WEBSOCKET,
    upgradeClass: WEBSOCKET_UPGRADE_CLASS.PAGE_ID,
    expectedCloseCodes: [1000],
  },
  {
    id: ManagedWebSocketRouteId.RECORDING,
    path: "/v1/sessions/recording",
    affinity: AFFINITY_RULE.UNSCOPED_ACTIVE_SESSION,
    lifecycle: LIFECYCLE_CLASS.WEBSOCKET,
    upgradeClass: WEBSOCKET_UPGRADE_CLASS.RECORDING,
    expectedCloseCodes: [1000],
  },
  {
    id: ManagedWebSocketRouteId.CDP,
    path: "/",
    affinity: AFFINITY_RULE.UNSCOPED_ACTIVE_SESSION,
    lifecycle: LIFECYCLE_CLASS.WEBSOCKET,
    upgradeClass: WEBSOCKET_UPGRADE_CLASS.ROOT_CDP,
    expectedCloseCodes: [1000],
  },
] as const

export class InvalidWebSocketQueryError extends Error {
  public override readonly name = "InvalidWebSocketQueryError"
}

export class WebSocketRouteNotFoundError extends Error {
  public override readonly name = "WebSocketRouteNotFoundError"
}

export type WebSocketUpgradeTarget = {
  readonly routeId: ManagedWebSocketRouteId
  readonly sessionId: PublicSessionId
  readonly upstreamPathAndQuery: string
  readonly worker: WorkerDescriptor
}

type RouteMatch = {
  readonly pathSessionId?: PublicSessionId
  readonly routeId: ManagedWebSocketRouteId
  readonly upstreamPath: string
}

const CAST_QUERY_SCHEMAS = {
  pageId: z.string().min(1).max(256).regex(/^[A-Za-z0-9._:-]+$/u),
  pageIndex: z.string().regex(/^(0|[1-9][0-9]{0,3})$/u),
  tabInfo: z.union([z.literal("true"), z.literal("false")]),
} as const

const CastQueryName = {
  PAGE_ID: "pageId",
  PAGE_INDEX: "pageIndex",
  SESSION_ID: "sessionId",
  TAB_INFO: "tabInfo",
} as const

export function resolveWebSocketUpgrade(input: {
  readonly headers: Readonly<Record<string, string | undefined>>
  readonly pathAndQuery: string
  readonly registry: WorkerRegistry
}): WebSocketUpgradeTarget {
  const url = publicRequestUrl(input.pathAndQuery)
  const route = matchRoute(url.pathname)
  const sessionId = resolveSessionAffinity(
    {
      ...(route.pathSessionId === undefined ? {} : { path: route.pathSessionId }),
      ...headerAffinity(input.headers),
      ...queryAffinity(url.searchParams),
    },
    input.registry.liveSessionIds(),
  )
  return {
    routeId: route.routeId,
    sessionId,
    upstreamPathAndQuery: upstreamPathAndQuery(route, url.searchParams),
    worker: input.registry.workerForSession(sessionId),
  }
}

function publicRequestUrl(pathAndQuery: string): URL {
  if (canonicalPublicPathname(pathAndQuery) === undefined) {
    throw new WebSocketRouteNotFoundError("websocket route was not found")
  }
  try {
    return new URL(pathAndQuery, "https://managed.invalid")
  } catch {
    throw new WebSocketRouteNotFoundError("websocket route was not found")
  }
}

function matchRoute(pathname: string): RouteMatch {
  const exact = EXACT_ROUTES.get(pathname)
  if (exact !== undefined) return exact
  const cast = /^\/v1\/sessions\/([^/]+)\/cast$/u.exec(pathname)
  if (cast !== null) {
    const encodedSessionId = cast[1]
    if (encodedSessionId === undefined) throw new WebSocketRouteNotFoundError()
    let decoded: string
    try {
      decoded = decodeURIComponent(encodedSessionId)
    } catch {
      throw new WebSocketRouteNotFoundError()
    }
    return {
      routeId: ManagedWebSocketRouteId.CAST,
      pathSessionId: PublicSessionIdSchema.parse(decoded),
      upstreamPath: "/v1/sessions/cast",
    }
  }
  if (/^\/devtools\/(browser|page)\/[A-Za-z0-9._:-]+$/u.test(pathname)) {
    return {
      routeId: ManagedWebSocketRouteId.CDP,
      upstreamPath: pathname,
    }
  }
  throw new WebSocketRouteNotFoundError("websocket route was not found")
}

const EXACT_ROUTES: ReadonlyMap<string, RouteMatch> = new Map(
  PUBLIC_WEBSOCKET_ROUTES.map(({ id, path }) => [
    path,
    { routeId: id, upstreamPath: path },
  ]),
)

function headerAffinity(
  headers: Readonly<Record<string, string | undefined>>,
): { readonly header?: PublicSessionId } {
  const raw = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === "x-steel-session-id",
  )?.[1]
  return raw === undefined ? {} : { header: PublicSessionIdSchema.parse(raw) }
}

function queryAffinity(
  searchParams: URLSearchParams,
): { readonly query?: PublicSessionId } {
  const values = searchParams.getAll(CastQueryName.SESSION_ID)
  if (values.length > 1) throw new InvalidWebSocketQueryError("duplicate session affinity")
  const raw = values[0]
  return raw === undefined ? {} : { query: PublicSessionIdSchema.parse(raw) }
}

function upstreamPathAndQuery(route: RouteMatch, input: URLSearchParams): string {
  const output = new URLSearchParams()
  for (const [name, value] of input) {
    if (name === CastQueryName.SESSION_ID) continue
    if (route.routeId !== ManagedWebSocketRouteId.CAST) {
      throw new InvalidWebSocketQueryError("query is not supported for this websocket route")
    }
    if (input.getAll(name).length !== 1 || !validCastQuery(name, value)) {
      throw new InvalidWebSocketQueryError("cast query is invalid")
    }
    output.set(name, value)
  }
  const query = output.toString()
  return query.length === 0 ? route.upstreamPath : `${route.upstreamPath}?${query}`
}

function validCastQuery(name: string, value: string): boolean {
  switch (name) {
    case CastQueryName.PAGE_ID:
      return CAST_QUERY_SCHEMAS.pageId.safeParse(value).success
    case CastQueryName.PAGE_INDEX:
      return CAST_QUERY_SCHEMAS.pageIndex.safeParse(value).success
    case CastQueryName.TAB_INFO:
      return CAST_QUERY_SCHEMAS.tabInfo.safeParse(value).success
    default:
      return false
  }
}
