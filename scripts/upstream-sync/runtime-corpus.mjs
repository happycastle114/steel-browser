import { createHash } from "node:crypto"

import { SESSION_ID_MODE } from "./corpus-schema.mjs"
import { PROTOCOL, routeKey } from "./runtime-route-source.mjs"

const sha256 = (value) => createHash("sha256").update(value).digest("hex")
const jsonText = (value) => `${JSON.stringify(value, null, 2)}\n`
const ndjsonText = (values) => `${values.map((value) => JSON.stringify(value)).join("\n")}\n`

export function assembleRuntimeCorpus({ upstreamSha, sources, discovered, matrixRoutes, restRecords, webSocketRecords, sessionVerdict }) {
  const routeMatrixText = jsonText({ schemaVersion: 1, upstreamSha, runtimeProfile: { nodeEnv: "development", logStorageEnabled: true }, routes: matrixRoutes })
  const sessionVerdictText = jsonText({ schemaVersion: 1, upstreamSha, ...sessionVerdict })
  const restText = ndjsonText(restRecords)
  const webSocketText = ndjsonText(webSocketRecords)
  const observedReceiptText = jsonText({
    schemaVersion: 1,
    upstreamSha,
    routeMatrixSha256: sha256(routeMatrixText),
    sessionIdVerdictSha256: sha256(sessionVerdictText),
    rest: restRecords.map((record) => ({ id: record.id, routeId: record.routeId, request: { method: record.request.method, path: record.request.path }, response: { status: record.response.status, contentType: record.response.contentType, headers: record.response.headers, bodySha256: record.response.bodySha256, urlFields: record.response.urlFields } })),
    webSocket: webSocketRecords.map((record) => ({ id: record.id, routeId: record.routeId, requestPath: record.requestPath, opened: record.opened, messageKind: record.messageKind, closeCode: record.closeCode })),
  })
  const manifestText = jsonText({
    schemaVersion: 1,
    upstreamSha,
    sessionIdMode: SESSION_ID_MODE.CLIENT_SUPPLIED,
    sourceInventorySha256: sha256(`${discovered.map(routeKey).join("\n")}\n`),
    sources: sources.map((source) => ({ path: source.path, sha256: sha256(source.text) })),
    artifacts: [
      { path: "rest.ndjson", sha256: sha256(restText), records: restRecords.length },
      { path: "websocket.ndjson", sha256: sha256(webSocketText), records: webSocketRecords.length },
      { path: "route-matrix.json", sha256: sha256(routeMatrixText), records: matrixRoutes.length },
      { path: "session-id-verdict.json", sha256: sha256(sessionVerdictText), records: 1 },
    ],
    restRouteCount: matrixRoutes.filter((route) => route.protocol === PROTOCOL.REST).length,
    webSocketRouteCount: matrixRoutes.filter((route) => route.protocol === PROTOCOL.WEBSOCKET).length,
  })
  return [
    { path: "manifest.json", text: manifestText },
    { path: "observed-receipt.json", text: observedReceiptText },
    { path: "rest.ndjson", text: restText },
    { path: "route-matrix.json", text: routeMatrixText },
    { path: "session-id-verdict.json", text: sessionVerdictText },
    { path: "websocket.ndjson", text: webSocketText },
  ]
}
