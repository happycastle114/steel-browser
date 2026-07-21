import { LOCK_STAGE, parseUpstreamLock } from "./upstream-lock.js"
import {
  CorpusVerificationError,
  parseJson,
  parseNdjson,
  sha256,
} from "./upstream-corpus-primitives.js"
import {
  CorpusManifestSchema,
  PROTOCOL_KIND,
  RestCorpusEntrySchema,
  RouteMatrixSchema,
  SessionIdVerdictSchema,
  WebSocketCorpusEntrySchema,
} from "./upstream-corpus-model.js"
import { verifyObservedReceipt } from "./upstream-observed-receipt.js"
import {
  matrixRouteKey,
  requireEqual,
  requireUnique,
  verifyRestEntries,
  verifySessionIdVerdict,
  verifySourceInventory,
  verifyWebSocketEntries,
} from "./upstream-corpus-verification-rules.js"

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
  const sourceInventorySha256 = verifySourceInventory(bundle.sources, matrixKeys)
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
