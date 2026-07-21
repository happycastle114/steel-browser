import { createHash } from "node:crypto"
import path from "node:path"

export const UPSTREAM_SHA_PATTERN = /^[0-9a-f]{40}$/u
export const DIGEST_PATTERN = /^[0-9a-f]{64}$/u
export const IMAGE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u
const BODY_KINDS = new Set(["BINARY", "EMPTY", "HTML", "JSON", "MULTIPART", "SSE", "TEXT", "YAML"])
const HTTP_METHODS = new Set(["ALL", "DELETE", "GET", "HEAD", "OPTIONS", "POST"])
const SESSION_MODES = new Set(["CLIENT_SUPPLIED", "UPSTREAM_RETURNED"])
const REST_ARTIFACTS = new Set(["rest.ndjson", "websocket.ndjson", "route-matrix.json", "session-id-verdict.json"])
const RUNTIME_CONDITIONS = new Set(["ALWAYS", "LOG_STORAGE_ENABLED"])
const AFFINITY_RULES = new Set(["CREATE", "NONE", "PATH_SESSION_ID", "UNSCOPED_ACTIVE_SESSION"])
const LIFECYCLE_CLASSES = new Set(["ACTION", "CONTEXT", "CREATE", "DEBUG", "DOCUMENTATION", "EVENT", "FILE", "HEALTH", "LIVE_DETAILS", "LOG", "READ", "RELEASE", "SELENIUM", "WEBSOCKET"])
const UPGRADE_CLASSES = new Set(["CAST", "LOGS", "PAGE_ID", "RECORDING", "ROOT_CDP"])
const MESSAGE_KINDS = new Set(["BROWSER_GET_VERSION", "OPEN_NO_MESSAGE", "TAB_LIST"])

export function assertUpstreamSha(value) {
  if (!UPSTREAM_SHA_PATTERN.test(value)) throw new Error(`upstream SHA must be 40 lowercase hexadecimal characters: ${String(value)}`)
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

export function parseObject(text, artifact) {
  try {
    const value = JSON.parse(text)
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object")
    return value
  } catch {
    throw new Error(`observed ${artifact} is not valid JSON`)
  }
}

function assertObject(value, artifact) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${artifact} must be a JSON object`)
  return value
}

function assertExactKeys(value, keys, artifact) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${artifact} schema keys are not exact (expected=${expected.join(",")}; actual=${actual.join(",")})`)
}

function assertDigest(value, artifact) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) throw new Error(`${artifact} must contain a lowercase SHA-256 digest`)
}

function assertNonEmptyString(value, artifact) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${artifact} must be a non-empty string`)
}

function assertSafeRelativePath(value, artifact) {
  assertNonEmptyString(value, artifact)
  if (path.posix.isAbsolute(value) || value.split("/").includes("..") || value.includes("\\")) throw new Error(`${artifact} contains an unsafe relative path`)
}

function parseNdjson(text, artifact) {
  const lines = text.split(/\r?\n/u).filter((line) => line.trim() !== "")
  if (lines.length === 0) throw new Error(`${artifact} must contain at least one JSON record`)
  return lines.map((line, index) => {
    try {
      return assertObject(JSON.parse(line), `${artifact} record ${index + 1}`)
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(`${artifact} record ${index + 1} is not valid JSON`)
      throw error
    }
  })
}

function assertRestRecord(record, artifact) {
  assertExactKeys(record, ["schemaVersion", "id", "routeId", "scenario", "request", "response"], artifact)
  if (record.schemaVersion !== 1 || typeof record.id !== "string" || !IDENTIFIER_PATTERN.test(record.id) || typeof record.routeId !== "string" || !IDENTIFIER_PATTERN.test(record.routeId)) throw new Error(`${artifact} identity is invalid`)
  assertNonEmptyString(record.scenario, `${artifact}.scenario`)
  assertObject(record.request, `${artifact}.request`)
  assertExactKeys(record.request, ["method", "path", "bodyKind"], `${artifact}.request`)
  if (!HTTP_METHODS.has(record.request.method) || typeof record.request.path !== "string" || !record.request.path.startsWith("/") || !BODY_KINDS.has(record.request.bodyKind)) throw new Error(`${artifact}.request is invalid`)
  assertObject(record.response, `${artifact}.response`)
  assertExactKeys(record.response, ["status", "contentType", "headers", "bodyKind", "bodySha256", "urlFields"], `${artifact}.response`)
  if (!Number.isInteger(record.response.status) || record.response.status < 100 || record.response.status > 599 || typeof record.response.contentType !== "string" || !BODY_KINDS.has(record.response.bodyKind)) throw new Error(`${artifact}.response is invalid`)
  if (record.response.headers === null || typeof record.response.headers !== "object" || Array.isArray(record.response.headers) || Object.values(record.response.headers).some((value) => typeof value !== "string")) throw new Error(`${artifact}.response.headers is invalid`)
  if (record.response.urlFields === null || typeof record.response.urlFields !== "object" || Array.isArray(record.response.urlFields) || Object.values(record.response.urlFields).some((value) => typeof value !== "string")) throw new Error(`${artifact}.response.urlFields is invalid`)
  assertDigest(record.response.bodySha256, `${artifact}.response.bodySha256`)
}

function assertWebSocketRecord(record, artifact) {
  assertExactKeys(record, ["schemaVersion", "id", "routeId", "scenario", "requestPath", "opened", "messageKind", "closeCode"], artifact)
  if (record.schemaVersion !== 1 || typeof record.id !== "string" || !IDENTIFIER_PATTERN.test(record.id) || typeof record.routeId !== "string" || !IDENTIFIER_PATTERN.test(record.routeId)) throw new Error(`${artifact} identity is invalid`)
  assertNonEmptyString(record.scenario, `${artifact}.scenario`)
  if (typeof record.requestPath !== "string" || !record.requestPath.startsWith("/") || record.opened !== true || !MESSAGE_KINDS.has(record.messageKind) || !Number.isInteger(record.closeCode) || record.closeCode < 1000 || record.closeCode > 4999) throw new Error(`${artifact} is invalid`)
}

function assertRoute(route, artifact) {
  if (route === null || typeof route !== "object" || Array.isArray(route)) throw new Error(`${artifact} must be an object`)
  if (route.protocol === "REST") {
    assertExactKeys(route, ["protocol", "id", "method", "path", "source", "runtimeCondition", "affinity", "lifecycle", "mutating", "implicitHead", "expected"], artifact)
    if (typeof route.id !== "string" || !IDENTIFIER_PATTERN.test(route.id) || !HTTP_METHODS.has(route.method) || typeof route.path !== "string" || !route.path.startsWith("/") || typeof route.source !== "string" || route.source.trim() === "" || !RUNTIME_CONDITIONS.has(route.runtimeCondition) || !AFFINITY_RULES.has(route.affinity) || !LIFECYCLE_CLASSES.has(route.lifecycle) || typeof route.mutating !== "boolean" || typeof route.implicitHead !== "boolean") throw new Error(`${artifact} REST route is invalid`)
    assertObject(route.expected, `${artifact}.expected`)
    assertExactKeys(route.expected, ["statuses", "contentTypes", "headers", "urlFields"], `${artifact}.expected`)
    if (!Array.isArray(route.expected.statuses) || route.expected.statuses.length === 0 || route.expected.statuses.some((status) => !Number.isInteger(status) || status < 100 || status > 599) || !Array.isArray(route.expected.contentTypes) || route.expected.contentTypes.length === 0 || route.expected.contentTypes.some((value) => typeof value !== "string") || !Array.isArray(route.expected.headers) || route.expected.headers.some((value) => typeof value !== "string") || !Array.isArray(route.expected.urlFields) || route.expected.urlFields.some((value) => typeof value !== "string")) throw new Error(`${artifact}.expected is invalid`)
    return
  }
  if (route.protocol === "WEBSOCKET") {
    assertExactKeys(route, ["protocol", "id", "path", "source", "runtimeCondition", "affinity", "lifecycle", "mutating", "upgradeClass", "expectedCloseCodes"], artifact)
    if (typeof route.id !== "string" || !IDENTIFIER_PATTERN.test(route.id) || typeof route.path !== "string" || !route.path.startsWith("/") || typeof route.source !== "string" || route.source.trim() === "" || !RUNTIME_CONDITIONS.has(route.runtimeCondition) || !AFFINITY_RULES.has(route.affinity) || route.lifecycle !== "WEBSOCKET" || typeof route.mutating !== "boolean" || !UPGRADE_CLASSES.has(route.upgradeClass) || !Array.isArray(route.expectedCloseCodes) || route.expectedCloseCodes.length === 0 || route.expectedCloseCodes.some((code) => !Number.isInteger(code) || code < 1000 || code > 4999)) throw new Error(`${artifact} WebSocket route is invalid`)
    return
  }
  throw new Error(`${artifact} protocol is invalid: ${String(route.protocol)}`)
}

export function assertRuntimeIdentity(identity, upstreamSha) {
  if (identity === null || typeof identity !== "object" || Array.isArray(identity)) throw new Error("runtime identity must be an object")
  if (identity.upstreamSha !== upstreamSha || identity.gitHead !== upstreamSha) throw new Error("observed runtime identity is not pinned to the requested upstream SHA")
  assertExactKeys(identity, ["schemaVersion", "upstreamSha", "gitHead", "runtimeVersion", "browserVersion", "workerImageDigest"], "runtime identity")
  if (identity.schemaVersion !== 1 || typeof identity.runtimeVersion !== "string" || identity.runtimeVersion.trim() === "") throw new Error("runtime identity is missing its version contract")
  if (/^(?:fixture|fake|unknown)(?:[-/]|$)/iu.test(identity.runtimeVersion.trim())) throw new Error("runtime identity runtimeVersion is fabricated")
  if (typeof identity.browserVersion !== "string" || identity.browserVersion.trim() === "") throw new Error("runtime identity is missing browserVersion")
  if (/^(?:fixture|fake|unknown)(?:[-/]|$)/iu.test(identity.browserVersion.trim())) throw new Error("runtime identity browserVersion is fabricated")
  if (typeof identity.workerImageDigest !== "string" || !IMAGE_DIGEST_PATTERN.test(identity.workerImageDigest)) throw new Error("runtime identity workerImageDigest is not pinned")
  if (/^sha256:(.)\1{63}$/u.test(identity.workerImageDigest)) throw new Error("runtime identity workerImageDigest is fabricated")
}

export function assertStrictCoreArtifacts(texts, upstreamSha) {
  const manifest = assertObject(JSON.parse(texts.get("manifest.json")), "manifest")
  assertExactKeys(manifest, ["schemaVersion", "upstreamSha", "sessionIdMode", "sourceInventorySha256", "sources", "artifacts", "restRouteCount", "webSocketRouteCount"], "manifest")
  if (manifest.schemaVersion !== 1 || manifest.upstreamSha !== upstreamSha || !SESSION_MODES.has(manifest.sessionIdMode) || !Number.isInteger(manifest.restRouteCount) || manifest.restRouteCount <= 0 || !Number.isInteger(manifest.webSocketRouteCount) || manifest.webSocketRouteCount <= 0) throw new Error("manifest contract is invalid")
  assertDigest(manifest.sourceInventorySha256, "manifest.sourceInventorySha256")
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) throw new Error("manifest sources must be non-empty")
  for (const source of manifest.sources) { assertObject(source, "manifest source"); assertExactKeys(source, ["path", "sha256"], "manifest source"); assertSafeRelativePath(source.path, "manifest source path"); assertDigest(source.sha256, "manifest source hash") }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== 4) throw new Error("manifest must contain exactly four protocol artifacts")
  const artifactNames = new Set()
  for (const artifact of manifest.artifacts) { assertObject(artifact, "manifest artifact"); assertExactKeys(artifact, ["path", "sha256", "records"], "manifest artifact"); if (!REST_ARTIFACTS.has(artifact.path) || artifactNames.has(artifact.path) || !Number.isInteger(artifact.records) || artifact.records <= 0) throw new Error("manifest artifact entry is invalid"); artifactNames.add(artifact.path); assertDigest(artifact.sha256, `manifest artifact ${artifact.path}`) }
  for (const required of REST_ARTIFACTS) if (!artifactNames.has(required)) throw new Error(`manifest omits required artifact: ${required}`)

  const matrix = assertObject(JSON.parse(texts.get("route-matrix.json")), "route matrix")
  assertExactKeys(matrix, ["schemaVersion", "upstreamSha", "runtimeProfile", "routes"], "route matrix")
  assertObject(matrix.runtimeProfile, "route matrix runtimeProfile"); assertExactKeys(matrix.runtimeProfile, ["nodeEnv", "logStorageEnabled"], "route matrix runtimeProfile")
  if (matrix.schemaVersion !== 1 || matrix.upstreamSha !== upstreamSha || matrix.runtimeProfile.nodeEnv !== "development" || matrix.runtimeProfile.logStorageEnabled !== true || !Array.isArray(matrix.routes) || matrix.routes.length === 0) throw new Error("route matrix contract is invalid")
  const routeIds = new Set()
  for (const route of matrix.routes) { assertRoute(route, "route matrix route"); if (routeIds.has(route.id)) throw new Error(`route matrix contains duplicate route ID: ${route.id}`); routeIds.add(route.id) }
  if (matrix.routes.filter((route) => route.protocol === "REST").length !== manifest.restRouteCount || matrix.routes.filter((route) => route.protocol === "WEBSOCKET").length !== manifest.webSocketRouteCount) throw new Error("manifest route counts drift")

  const verdict = assertObject(JSON.parse(texts.get("session-id-verdict.json")), "session verdict")
  assertExactKeys(verdict, ["schemaVersion", "upstreamSha", "mode", "callerSessionId", "createReturnedCallerId", "freshConnectionListRecoveredActiveId", "freshConnectionGetRecoveredActiveId", "releaseReturnedActiveId", "createJournalBinding"], "session verdict")
  if (verdict.schemaVersion !== 1 || verdict.upstreamSha !== upstreamSha || !SESSION_MODES.has(verdict.mode) || typeof verdict.callerSessionId !== "string" || !UUID_PATTERN.test(verdict.callerSessionId) || typeof verdict.createReturnedCallerId !== "boolean" || typeof verdict.freshConnectionListRecoveredActiveId !== "boolean" || typeof verdict.freshConnectionGetRecoveredActiveId !== "boolean" || typeof verdict.releaseReturnedActiveId !== "boolean" || !["CLIENT_ID_DIRECT", "CREATE_TOKEN_TO_UPSTREAM_RETURNED_ID"].includes(verdict.createJournalBinding)) throw new Error("session verdict contract is invalid")
  if (verdict.mode === "CLIENT_SUPPLIED" && (verdict.createReturnedCallerId !== true || verdict.createJournalBinding !== "CLIENT_ID_DIRECT")) throw new Error("client-supplied session verdict is inconsistent")
  if (verdict.mode === "UPSTREAM_RETURNED" && (verdict.createReturnedCallerId !== false || verdict.createJournalBinding !== "CREATE_TOKEN_TO_UPSTREAM_RETURNED_ID")) throw new Error("upstream-returned session verdict is inconsistent")
  if (verdict.freshConnectionListRecoveredActiveId !== true || verdict.freshConnectionGetRecoveredActiveId !== true || verdict.releaseReturnedActiveId !== true) throw new Error("session lifecycle verdict is not proven")

  const restRecords = parseNdjson(texts.get("rest.ndjson"), "rest.ndjson")
  const webSocketRecords = parseNdjson(texts.get("websocket.ndjson"), "websocket.ndjson")
  const recordIds = new Set()
  for (const record of restRecords) { assertRestRecord(record, "rest.ndjson record"); if (recordIds.has(record.id)) throw new Error(`duplicate corpus record ID: ${record.id}`); recordIds.add(record.id); if (!routeIds.has(record.routeId) || matrix.routes.find((route) => route.id === record.routeId)?.protocol !== "REST") throw new Error(`REST corpus references an unknown route: ${record.routeId}`) }
  for (const record of webSocketRecords) { assertWebSocketRecord(record, "websocket.ndjson record"); if (recordIds.has(record.id)) throw new Error(`duplicate corpus record ID: ${record.id}`); recordIds.add(record.id); if (!routeIds.has(record.routeId) || matrix.routes.find((route) => route.id === record.routeId)?.protocol !== "WEBSOCKET") throw new Error(`WebSocket corpus references an unknown route: ${record.routeId}`) }
  if (restRecords.length === 0 || webSocketRecords.length === 0) throw new Error("protocol corpus must contain REST and WebSocket records")
  for (const artifact of manifest.artifacts) { const text = texts.get(artifact.path); const records = artifact.path === "rest.ndjson" ? restRecords.length : artifact.path === "websocket.ndjson" ? webSocketRecords.length : artifact.path === "route-matrix.json" ? matrix.routes.length : 1; if (sha256(Buffer.from(text, "utf8")) !== artifact.sha256 || records !== artifact.records) throw new Error(`manifest artifact digest drift: ${artifact.path}`) }

  const receipt = assertObject(JSON.parse(texts.get("observed-receipt.json")), "observed receipt")
  assertExactKeys(receipt, ["schemaVersion", "upstreamSha", "routeMatrixSha256", "sessionIdVerdictSha256", "rest", "webSocket"], "observed receipt"); assertDigest(receipt.routeMatrixSha256, "observed receipt route matrix digest"); assertDigest(receipt.sessionIdVerdictSha256, "observed receipt session verdict digest")
  if (receipt.schemaVersion !== 1 || receipt.upstreamSha !== upstreamSha || !Array.isArray(receipt.rest) || receipt.rest.length !== restRecords.length || !Array.isArray(receipt.webSocket) || receipt.webSocket.length !== webSocketRecords.length) throw new Error("observed receipt contract is invalid")
  if (receipt.routeMatrixSha256 !== sha256(Buffer.from(texts.get("route-matrix.json"), "utf8")) || receipt.sessionIdVerdictSha256 !== sha256(Buffer.from(texts.get("session-id-verdict.json"), "utf8"))) throw new Error("observed receipt digest drift")
  for (const [entries, expected, label] of [[receipt.rest, restRecords, "REST"], [receipt.webSocket, webSocketRecords, "WebSocket"]]) { const ids = new Set(); for (const entry of entries) { assertObject(entry, `${label} receipt entry`); if (label === "REST") { assertExactKeys(entry, ["id", "routeId", "request", "response"], `${label} receipt entry`); assertObject(entry.request, `${label} receipt request`); assertExactKeys(entry.request, ["method", "path"], `${label} receipt request`); assertObject(entry.response, `${label} receipt response`); assertExactKeys(entry.response, ["status", "contentType", "headers", "bodySha256", "urlFields"], `${label} receipt response`); if (!HTTP_METHODS.has(entry.request.method) || typeof entry.request.path !== "string" || !entry.request.path.startsWith("/") || !Number.isInteger(entry.response.status) || entry.response.status < 100 || entry.response.status > 599 || typeof entry.response.contentType !== "string" || entry.response.headers === null || typeof entry.response.headers !== "object" || Array.isArray(entry.response.headers) || Object.values(entry.response.headers).some((value) => typeof value !== "string") || entry.response.urlFields === null || typeof entry.response.urlFields !== "object" || Array.isArray(entry.response.urlFields) || Object.values(entry.response.urlFields).some((value) => typeof value !== "string")) throw new Error(`${label} receipt entry is invalid`); assertDigest(entry.response.bodySha256, `${label} receipt response body digest`) } else { assertExactKeys(entry, ["id", "routeId", "requestPath", "opened", "messageKind", "closeCode"], `${label} receipt entry`); if (typeof entry.requestPath !== "string" || !entry.requestPath.startsWith("/") || entry.opened !== true || !MESSAGE_KINDS.has(entry.messageKind) || !Number.isInteger(entry.closeCode) || entry.closeCode < 1000 || entry.closeCode > 4999) throw new Error(`${label} receipt entry is invalid`) } if (typeof entry.id !== "string" || ids.has(entry.id)) throw new Error(`${label} receipt contains duplicate IDs`); ids.add(entry.id); const actual = expected.find((record) => record.id === entry.id); if (actual === undefined || actual.routeId !== entry.routeId) throw new Error(`${label} receipt record binding drift: ${entry.id}`) } }
  return { manifest, matrix, verdict, restRecords, webSocketRecords, receipt }
}
