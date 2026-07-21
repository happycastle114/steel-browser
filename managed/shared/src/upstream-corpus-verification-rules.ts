import { CorpusVerificationError, sha256 } from "./upstream-corpus-primitives.js"
import {
  CREATE_JOURNAL_BINDING,
  HTTP_METHOD,
  PROTOCOL_KIND,
  SESSION_ID_MODE,
  WEBSOCKET_MESSAGE_BY_UPGRADE,
  type RestCorpusEntry,
  type RouteMatrix,
  type SessionIdVerdict,
  type WebSocketCorpusEntry,
} from "./upstream-corpus-model.js"
import {
  discoverPinnedRuntimeRoutes,
  PINNED_ROUTE_SOURCE_PATHS,
  routeKey,
  type DiscoveredRoute,
} from "./upstream-route-source.js"

type MatrixRoute = RouteMatrix["routes"][number]
type CorpusSource = Readonly<{ readonly path: string; readonly text: string }>

export function requireEqual(actual: unknown, expected: unknown, detail: string): void {
  if (actual !== expected) throw new CorpusVerificationError(detail)
}

export function requireUnique(values: readonly string[], detail: string): void {
  if (new Set(values).size !== values.length) throw new CorpusVerificationError(detail)
}

function assertNever(value: never): never {
  throw new CorpusVerificationError(`unhandled session ID mode: ${JSON.stringify(value)}`)
}

export function verifySessionIdVerdict(verdict: SessionIdVerdict): void {
  switch (verdict.mode) {
    case SESSION_ID_MODE.CLIENT_SUPPLIED:
      requireEqual(verdict.createReturnedCallerId, true, "caller session ID was not retained")
      requireEqual(verdict.createJournalBinding, CREATE_JOURNAL_BINDING.CLIENT_ID_DIRECT, "client ID journal binding drift")
      break
    case SESSION_ID_MODE.UPSTREAM_RETURNED:
      requireEqual(verdict.createReturnedCallerId, false, "returned-ID mode retained caller ID")
      requireEqual(
        verdict.createJournalBinding,
        CREATE_JOURNAL_BINDING.CREATE_TOKEN_TO_UPSTREAM_RETURNED_ID,
        "returned ID journal binding drift",
      )
      break
    default:
      return assertNever(verdict.mode)
  }
  requireEqual(verdict.freshConnectionListRecoveredActiveId, true, "active ID was not recovered by list after disconnect")
  requireEqual(verdict.freshConnectionGetRecoveredActiveId, true, "active ID was not recovered by get after disconnect")
  requireEqual(verdict.releaseReturnedActiveId, true, "release returned a different active ID")
}

export function matrixRouteKey(route: MatrixRoute): string {
  const method: DiscoveredRoute["method"] = route.protocol === PROTOCOL_KIND.REST ? route.method : "UPGRADE"
  return routeKey({ protocol: route.protocol, method, path: route.path, source: route.source })
}

export function verifySourceInventory(sources: readonly CorpusSource[], matrixRoutes: readonly string[]): string {
  const sortText = (left: string, right: string) => left.localeCompare(right)
  const expectedPaths = [...PINNED_ROUTE_SOURCE_PATHS].sort(sortText)
  const actualPaths = sources.map((source) => source.path).sort(sortText)
  requireEqual(JSON.stringify(actualPaths), JSON.stringify(expectedPaths), "pinned source set drift")

  const discoveredKeys = discoverPinnedRuntimeRoutes(sources).map(routeKey)
  requireEqual(
    JSON.stringify([...matrixRoutes].sort(sortText)),
    JSON.stringify(discoveredKeys),
    "route matrix does not cover the pinned runtime source",
  )
  return sha256(`${discoveredKeys.join("\n")}\n`)
}

export function verifyRestEntries(
  entries: readonly RestCorpusEntry[],
  routeById: ReadonlyMap<string, MatrixRoute>,
): void {
  for (const entry of entries) {
    const route = routeById.get(entry.routeId)
    if (route === undefined || route.protocol !== PROTOCOL_KIND.REST) {
      throw new CorpusVerificationError(`unknown REST route reference: ${entry.routeId}`)
    }
    if (route.method !== HTTP_METHOD.ALL && entry.request.method !== route.method) {
      throw new CorpusVerificationError(`REST method drift: ${entry.routeId}`)
    }
    requireEqual(entry.request.path, route.path, `REST path drift: ${entry.routeId}`)
    if (!route.expected.statuses.includes(entry.response.status)) {
      throw new CorpusVerificationError(`REST status drift: ${entry.routeId}`)
    }
    if (!route.expected.contentTypes.includes(entry.response.contentType)) {
      throw new CorpusVerificationError(`REST content type drift: ${entry.routeId}`)
    }
    for (const header of route.expected.headers) {
      if (entry.response.headers[header] === undefined) {
        throw new CorpusVerificationError(`REST header drift: ${entry.routeId}:${header}`)
      }
    }
    requireEqual(
      JSON.stringify(Object.keys(entry.response.urlFields).sort()),
      JSON.stringify([...route.expected.urlFields].sort()),
      `REST URL fields drift: ${entry.routeId}`,
    )
  }
}

export function verifyWebSocketEntries(
  entries: readonly WebSocketCorpusEntry[],
  routeById: ReadonlyMap<string, MatrixRoute>,
): void {
  for (const entry of entries) {
    const route = routeById.get(entry.routeId)
    if (route === undefined || route.protocol !== PROTOCOL_KIND.WEBSOCKET) {
      throw new CorpusVerificationError(`unknown WebSocket route reference: ${entry.routeId}`)
    }
    if (route.expectedCloseCodes?.includes(entry.closeCode) !== true) {
      throw new CorpusVerificationError(`unexpected WebSocket close code: ${entry.routeId}`)
    }
    requireEqual(entry.requestPath, route.path, `WebSocket path drift: ${entry.routeId}`)
    requireEqual(
      entry.messageKind,
      WEBSOCKET_MESSAGE_BY_UPGRADE[route.upgradeClass],
      `WebSocket message drift: ${entry.routeId}`,
    )
  }
}
