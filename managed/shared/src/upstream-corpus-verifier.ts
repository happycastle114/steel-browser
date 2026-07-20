import { LOCK_STAGE, parseUpstreamLock } from "./upstream-lock.js"
import {
  CorpusVerificationError,
  parseJson,
  parseNdjson,
  sha256,
} from "./upstream-corpus-primitives.js"
import {
  CorpusManifestSchema,
  CREATE_JOURNAL_BINDING,
  HTTP_METHOD,
  PROTOCOL_KIND,
  RestCorpusEntrySchema,
  RouteMatrixSchema,
  SESSION_ID_MODE,
  SessionIdVerdictSchema,
  WEBSOCKET_MESSAGE_BY_UPGRADE,
  WebSocketCorpusEntrySchema,
  type RestCorpusEntry, type RouteMatrix, type SessionIdVerdict, type WebSocketCorpusEntry,
} from "./upstream-corpus-model.js"
import { verifyObservedReceipt } from "./upstream-observed-receipt.js"
import {
  discoverPinnedRuntimeRoutes,
  PINNED_ROUTE_SOURCE_PATHS,
  routeKey,
  type DiscoveredRoute,
} from "./upstream-route-source.js"

export type CorpusSource = { readonly path: string; readonly text: string }

export type CorpusBundle = {
  readonly lockText: string
  readonly manifestText: string
  readonly observedReceiptText: string
  readonly restText: string
  readonly webSocketText: string
  readonly routeMatrixText: string
  readonly sessionIdVerdictText: string
  readonly sources: readonly CorpusSource[]
}

export type CorpusVerification = {
  readonly upstreamSha: string
  readonly protocolCorpusSha256: string
  readonly sessionIdVerdictSha256: string
  readonly sessionIdMode: "CLIENT_SUPPLIED" | "UPSTREAM_RETURNED"
  readonly restRouteCount: number
  readonly webSocketRouteCount: number
}

export { CorpusVerificationError, sha256 } from "./upstream-corpus-primitives.js"

function requireEqual(actual: unknown, expected: unknown, detail: string): void {
  if (actual !== expected) {
    throw new CorpusVerificationError(detail)
  }
}

function requireUnique(values: readonly string[], detail: string): void {
  if (new Set(values).size !== values.length) {
    throw new CorpusVerificationError(detail)
  }
}

function assertNever(value: never): never {
  throw new CorpusVerificationError(`unhandled session ID mode: ${JSON.stringify(value)}`)
}

function verifySessionIdVerdict(verdict: SessionIdVerdict): void {
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
  requireEqual(
    verdict.freshConnectionListRecoveredActiveId,
    true,
    "active ID was not recovered by list after disconnect",
  )
  requireEqual(
    verdict.freshConnectionGetRecoveredActiveId,
    true,
    "active ID was not recovered by get after disconnect",
  )
  requireEqual(verdict.releaseReturnedActiveId, true, "release returned a different active ID")
}

type MatrixRoute = RouteMatrix["routes"][number]

function matrixRouteKey(route: MatrixRoute): string {
  const method: DiscoveredRoute["method"] =
    route.protocol === PROTOCOL_KIND.REST ? route.method : "UPGRADE"
  return routeKey({ protocol: route.protocol, method, path: route.path, source: route.source })
}

function verifySourceInventory(bundle: CorpusBundle, matrixRoutes: readonly string[]): string {
  const sortText = (left: string, right: string) => left.localeCompare(right)
  const expectedPaths = [...PINNED_ROUTE_SOURCE_PATHS].sort(sortText)
  const actualPaths = bundle.sources.map((source) => source.path).sort(sortText)
  requireEqual(JSON.stringify(actualPaths), JSON.stringify(expectedPaths), "pinned source set drift")

  const discovered = discoverPinnedRuntimeRoutes(bundle.sources)
  const discoveredKeys = discovered.map(routeKey)
  requireEqual(
    JSON.stringify([...matrixRoutes].sort(sortText)),
    JSON.stringify(discoveredKeys),
    "route matrix does not cover the pinned runtime source",
  )
  return sha256(`${discoveredKeys.join("\n")}\n`)
}

function verifyRestEntries(
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

function verifyWebSocketEntries(
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
    const expectedMessageKind = WEBSOCKET_MESSAGE_BY_UPGRADE[route.upgradeClass]
    requireEqual(entry.messageKind, expectedMessageKind, `WebSocket message drift: ${entry.routeId}`)
  }
}

export function verifyCorpusBundle(bundle: CorpusBundle): CorpusVerification {
  const lock = parseUpstreamLock(parseJson(bundle.lockText, "managed/upstream.lock.json"))
  if (lock.lockStage === LOCK_STAGE.BOOTSTRAP) {
    throw new CorpusVerificationError("upstream lock is not corpus-locked")
  }
  const manifest = CorpusManifestSchema.parse(parseJson(bundle.manifestText, "manifest.json"))
  const matrix = RouteMatrixSchema.parse(parseJson(bundle.routeMatrixText, "route-matrix.json"))
  const verdict = SessionIdVerdictSchema.parse(
    parseJson(bundle.sessionIdVerdictText, "session-id-verdict.json"),
  )
  const restEntries = parseNdjson(bundle.restText, "rest.ndjson").map((entry) =>
    RestCorpusEntrySchema.parse(entry),
  )
  const webSocketEntries = parseNdjson(bundle.webSocketText, "websocket.ndjson").map((entry) =>
    WebSocketCorpusEntrySchema.parse(entry),
  )

  requireEqual(manifest.upstreamSha, lock.upstreamSha, "manifest upstream SHA drift")
  requireEqual(matrix.upstreamSha, lock.upstreamSha, "route matrix upstream SHA drift")
  requireEqual(verdict.upstreamSha, lock.upstreamSha, "session verdict upstream SHA drift")
  verifySessionIdVerdict(verdict)

  const routeIds = matrix.routes.map((route) => route.id)
  requireUnique(routeIds, "duplicate route ID")
  const matrixKeys = matrix.routes.map(matrixRouteKey)
  requireUnique(matrixKeys, "duplicate route registration")
  const sourceInventorySha256 = verifySourceInventory(bundle, matrixKeys)
  requireEqual(manifest.sourceInventorySha256, sourceInventorySha256, "source inventory digest drift")

  const routeById = new Map(matrix.routes.map((route) => [route.id, route]))
  verifyRestEntries(restEntries, routeById)
  verifyWebSocketEntries(webSocketEntries, routeById)
  const referencedRouteIds = [...restEntries, ...webSocketEntries].map((entry) => entry.routeId)
  requireEqual(
    JSON.stringify([...new Set(referencedRouteIds)].sort()),
    JSON.stringify(routeIds.sort()),
    "one or more runtime routes have no corpus record",
  )
  verifyObservedReceipt({
    upstreamSha: lock.upstreamSha,
    receiptText: bundle.observedReceiptText,
    restText: bundle.restText,
    webSocketText: bundle.webSocketText,
    routeMatrixText: bundle.routeMatrixText,
    sessionIdVerdictText: bundle.sessionIdVerdictText,
  })

  const artifactInputs = new Map([
    ["rest.ndjson", { text: bundle.restText, records: restEntries.length }],
    ["websocket.ndjson", { text: bundle.webSocketText, records: webSocketEntries.length }],
    ["route-matrix.json", { text: bundle.routeMatrixText, records: matrix.routes.length }],
    ["session-id-verdict.json", { text: bundle.sessionIdVerdictText, records: 1 }],
  ])
  for (const artifact of manifest.artifacts) {
    const input = artifactInputs.get(artifact.path)
    if (input === undefined) {
      throw new CorpusVerificationError(`unknown manifest artifact: ${artifact.path}`)
    }
    requireEqual(artifact.sha256, sha256(input.text), `artifact digest drift: ${artifact.path}`)
    requireEqual(artifact.records, input.records, `artifact record count drift: ${artifact.path}`)
    artifactInputs.delete(artifact.path)
  }
  requireEqual(artifactInputs.size, 0, "manifest omits a required artifact")

  const sourceDigests = new Map(bundle.sources.map((source) => [source.path, sha256(source.text)]))
  for (const source of manifest.sources) {
    requireEqual(source.sha256, sourceDigests.get(source.path), `source digest drift: ${source.path}`)
    sourceDigests.delete(source.path)
  }
  requireEqual(sourceDigests.size, 0, "manifest omits a pinned source")

  const restRouteCount = matrix.routes.filter((route) => route.protocol === PROTOCOL_KIND.REST).length
  const webSocketRouteCount = matrix.routes.length - restRouteCount
  requireEqual(manifest.restRouteCount, restRouteCount, "REST route count drift")
  requireEqual(manifest.webSocketRouteCount, webSocketRouteCount, "WebSocket route count drift")
  requireEqual(manifest.sessionIdMode, verdict.mode, "manifest session ID mode drift")

  const protocolCorpusSha256 = sha256(bundle.manifestText)
  const sessionIdVerdictSha256 = sha256(bundle.sessionIdVerdictText)
  requireEqual(lock.protocolCorpusSha256, protocolCorpusSha256, "lock protocol corpus digest drift")
  requireEqual(lock.sessionIdVerdictSha256, sessionIdVerdictSha256, "lock session verdict digest drift")

  return {
    upstreamSha: lock.upstreamSha,
    protocolCorpusSha256,
    sessionIdVerdictSha256,
    sessionIdMode: verdict.mode,
    restRouteCount,
    webSocketRouteCount,
  }
}
