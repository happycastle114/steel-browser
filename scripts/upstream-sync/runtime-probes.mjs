import { execFile } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { promisify } from "node:util"

import { HTTP_METHOD } from "./runtime-route-source.mjs"

const execFileAsync = promisify(execFile)
const BODY_KIND = Object.freeze({ BINARY: "BINARY", EMPTY: "EMPTY", HTML: "HTML", JSON: "JSON", MULTIPART: "MULTIPART", SSE: "SSE", TEXT: "TEXT", YAML: "YAML" })
const MESSAGE_KIND = Object.freeze({ BROWSER_GET_VERSION: "BROWSER_GET_VERSION", OPEN_NO_MESSAGE: "OPEN_NO_MESSAGE", TAB_LIST: "TAB_LIST" })
const JSON_SCENARIO_BODY = Object.freeze({
  "rest.action.scrape": { url: "data:text/html,<title>Steel runtime</title><p>capture</p>" },
  "rest.action.screenshot": { url: "data:text/html,<title>Steel runtime</title><p>capture</p>" },
  "rest.action.pdf": { url: "data:text/html,<title>Steel runtime</title><p>capture</p>" },
  "rest.action.search": {},
  "rest.sessions.events": { events: [] },
  "rest.sessions.scrape": {},
  "rest.sessions.screenshot": {},
  "rest.sessions.pdf": {},
})

function blocked(message) {
  const error = new Error(message)
  error.code = "RUNTIME_CAPTURE_BLOCKED"
  throw error
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex")

function materializePath(routePath, sessionId) {
  if (routePath === "/*") return "/cors-probe"
  return routePath.replace(/:sessionId|:id/gu, sessionId).replace("*", "runtime-probe.txt")
}

function responseBodyKind(contentType, body) {
  if (body.length === 0) return BODY_KIND.EMPTY
  if (contentType.includes("application/json")) return BODY_KIND.JSON
  if (contentType.includes("text/html")) return BODY_KIND.HTML
  if (contentType.includes("text/event-stream")) return BODY_KIND.SSE
  if (contentType.includes("yaml")) return BODY_KIND.YAML
  if (contentType.startsWith("text/")) return BODY_KIND.TEXT
  if (contentType.includes("multipart")) return BODY_KIND.MULTIPART
  return BODY_KIND.BINARY
}

async function boundedResponseBody(response) {
  if (response.body === null) return Buffer.alloc(0)
  if (!response.headers.get("content-type")?.includes("text/event-stream")) return Buffer.from(await response.arrayBuffer())
  const reader = response.body.getReader()
  const result = await Promise.race([reader.read(), new Promise((resolve) => setTimeout(() => resolve({ value: new Uint8Array() }), 750))])
  await reader.cancel()
  return Buffer.from(result.value ?? new Uint8Array())
}

function jsonPointer(value, pointer) {
  return pointer.slice(1).split("/").reduce((current, segment) => current?.[segment.replace(/~1/gu, "/").replace(/~0/gu, "~")], value)
}

function extractUrlFields(expectedFields, response, body, json) {
  const result = {}
  const bodyText = body.toString("utf8")
  for (const field of expectedFields) {
    let value
    if (field.startsWith("header:")) value = response.headers.get(field.slice("header:".length))
    else if (field === "html:wsUrl") value = bodyText.match(/wss?:\/\/[^"'\s<]+/u)?.[0]
    else if (field === "yaml:servers.0.url") value = bodyText.match(/\burl:\s*([^\s]+)/u)?.[1]
    else value = jsonPointer(json, field)
    if (typeof value !== "string" || value.trim() === "") blocked(`live response omitted reviewed URL field ${field}`)
    result[field] = value
  }
  return result
}

function requestInput(route, sessionId) {
  if (route.id === "rest.sessions.create") return { bodyKind: BODY_KIND.JSON, body: JSON.stringify({ sessionId }) }
  if (route.id === "rest.files.upload") {
    const form = new FormData()
    form.append("file", new Blob(["steel-runtime-capture\n"], { type: "text/plain" }), "runtime-probe.txt")
    return { bodyKind: BODY_KIND.MULTIPART, body: form }
  }
  if (Object.hasOwn(JSON_SCENARIO_BODY, route.id)) return { bodyKind: BODY_KIND.JSON, body: JSON.stringify(JSON_SCENARIO_BODY[route.id]) }
  return { bodyKind: BODY_KIND.EMPTY }
}

function validateScenario(route, response, json) {
  if (!route.expected.statuses.includes(response.status)) blocked(`live REST status drift: ${route.id}:${response.status}`)
  const contentType = response.headers.get("content-type") ?? "none"
  if (!route.expected.contentTypes.includes(contentType)) blocked(`live REST content type drift: ${route.id}:${contentType}`)
  if (route.id === "rest.health" && (response.status !== 200 || json?.status !== "ok")) blocked("Steel health scenario did not prove a healthy browser service")
  if (route.id === "rest.sessions.create" && response.status !== 200) blocked("Steel create scenario did not launch a browser session")
  if (route.id === "rest.action.search" && response.status !== 400) blocked("Steel search error scenario did not preserve request validation")
  if (route.id === "rest.files.upload" && response.status !== 200) blocked("Steel multipart upload scenario failed")
}

export async function probeRest(baseUrl, route, sessionId) {
  const method = route.method === HTTP_METHOD.ALL ? HTTP_METHOD.GET : route.method
  const headers = { connection: "close", origin: "https://runtime-observer.invalid" }
  const input = requestInput(route, sessionId)
  const options = { method, headers, signal: AbortSignal.timeout(20_000), redirect: "manual" }
  if (input.body !== undefined) {
    options.body = input.body
    if (input.bodyKind === BODY_KIND.JSON) headers["content-type"] = "application/json"
  }
  const response = await fetch(`${baseUrl}${materializePath(route.path, sessionId)}`, options)
  const body = await boundedResponseBody(response)
  const contentType = response.headers.get("content-type") ?? "none"
  let json
  if (contentType.includes("application/json") && body.length > 0) {
    try { json = JSON.parse(body.toString("utf8")) } catch { blocked(`runtime returned invalid JSON for ${route.id}`) }
  }
  validateScenario(route, response, json)
  const observedHeaders = {}
  for (const header of route.expected.headers) {
    const value = response.headers.get(header)
    if (value === null) blocked(`live response omitted reviewed header ${route.id}:${header}`)
    observedHeaders[header] = value
  }
  const record = {
    schemaVersion: 1,
    id: `record.${route.id}`,
    routeId: route.id,
    scenario: "reviewed-live-runtime",
    request: { method, path: route.path, bodyKind: input.bodyKind },
    response: { status: response.status, contentType, headers: observedHeaders, bodyKind: responseBodyKind(contentType, body), bodySha256: sha256(body), urlFields: extractUrlFields(route.expected.urlFields, response, body, json) },
  }
  return { record, json }
}

export function containsSessionId(value, sessionId) {
  if (Array.isArray(value)) return value.some((entry) => containsSessionId(entry, sessionId))
  if (value === null || typeof value !== "object") return false
  if (value.id === sessionId) return true
  return Object.values(value).some((entry) => containsSessionId(entry, sessionId))
}

function parseWebSocketMessage(route, data) {
  let value
  try { value = JSON.parse(typeof data === "string" ? data : Buffer.from(data).toString("utf8")) } catch { blocked(`WebSocket returned invalid JSON: ${route.id}`) }
  if (route.upgradeClass === "CAST") {
    if (value?.type !== "tabList" || !Array.isArray(value.tabs)) blocked("cast WebSocket did not emit a tab list")
    return {}
  }
  if (route.upgradeClass === "ROOT_CDP") {
    if (value?.id !== 1 || typeof value?.result?.product !== "string" || typeof value?.result?.protocolVersion !== "string") blocked("root CDP WebSocket did not return Browser.getVersion")
    return { browserProduct: value.result.product }
  }
  blocked(`passive WebSocket emitted an unexpected message: ${route.id}`)
}

export async function probeWebSocket(baseUrl, route) {
  const expectedMessageKind = route.upgradeClass === "CAST" ? MESSAGE_KIND.TAB_LIST : route.upgradeClass === "ROOT_CDP" ? MESSAGE_KIND.BROWSER_GET_VERSION : MESSAGE_KIND.OPEN_NO_MESSAGE
  const url = `${baseUrl.replace("http://", "ws://")}${route.path}`
  const result = await new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    let opened = false
    let semantic = {}
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      socket.close(1011, "capture failed")
      reject(error)
    }
    const deadline = setTimeout(() => fail(new Error(`WebSocket capture timed out: ${route.id}`)), 8_000)
    const finish = (closeCode) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      resolve({ opened, closeCode, semantic })
    }
    socket.addEventListener("open", () => {
      opened = true
      if (route.upgradeClass === "ROOT_CDP") socket.send(JSON.stringify({ id: 1, method: "Browser.getVersion" }))
      if (expectedMessageKind === MESSAGE_KIND.OPEN_NO_MESSAGE) setTimeout(() => socket.close(1000, "observed"), 500)
    })
    socket.addEventListener("message", (event) => {
      try {
        semantic = parseWebSocketMessage(route, event.data)
        socket.close(1000, "observed")
      } catch (error) {
        fail(error)
      }
    })
    socket.addEventListener("error", () => fail(new Error(`WebSocket capture failed: ${route.id}`)))
    socket.addEventListener("close", (event) => finish(event.code))
  })
  if (!result.opened || !route.expectedCloseCodes.includes(result.closeCode)) blocked(`WebSocket close contract drift: ${route.id}:${result.closeCode}`)
  return { record: { schemaVersion: 1, id: `record.${route.id}`, routeId: route.id, scenario: "reviewed-live-runtime", requestPath: route.path, opened: true, messageKind: expectedMessageKind, closeCode: result.closeCode }, browserProduct: result.semantic.browserProduct }
}

export async function startExactWorker(workerImageDigest, { execute = execFileAsync, request = fetch } = {}) {
  const name = `steel-upstream-observer-${process.pid}-${randomBytes(4).toString("hex")}`
  let cleanupSubject = name
  let started = false
  try {
    const { stdout } = await execute("docker", ["run", "--detach", "--rm", "--init", "--read-only", "--user", "10001:10001", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--tmpfs", "/tmp:rw,nosuid,nodev,mode=1777", "--tmpfs", "/run:rw,nosuid,nodev,size=64m,mode=0755", "--tmpfs", "/files:rw,nosuid,nodev,uid=10001,gid=10001,mode=0700", "--tmpfs", "/app/.cache:rw,nosuid,nodev,uid=10001,gid=10001,mode=0700", "--name", name, "--publish", "127.0.0.1::3000", "--env", "NODE_ENV=development", "--env", "LOG_STORAGE_ENABLED=true", "--env", "HOST=0.0.0.0", "--env", "PORT=3000", "--env", "CHROME_HEADLESS=true", "--env", "HOME=/tmp/home", "--env", "XDG_RUNTIME_DIR=/tmp/runtime", "--entrypoint", "/usr/bin/dbus-run-session", workerImageDigest, "--", "/app/api/entrypoint.sh", "--no-nginx"], { timeout: 30_000, maxBuffer: 1024 * 1024 })
    started = true
    const containerId = stdout.trim()
    if (!/^[0-9a-f]{12,64}$/u.test(containerId)) blocked("Docker did not return an exact worker container ID")
    cleanupSubject = containerId
    const portResult = await execute("docker", ["port", containerId, "3000/tcp"], { timeout: 10_000 })
    const portMatch = portResult.stdout.trim().match(/:(\d+)$/u)
    if (portMatch === null) blocked("exact worker loopback port could not be resolved")
    const baseUrl = `http://127.0.0.1:${portMatch[1]}`
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      try {
        const response = await request(`${baseUrl}/v1/health`, { signal: AbortSignal.timeout(2_000) })
        const body = await response.json()
        if (response.status === 200 && body?.status === "ok") return { containerId, baseUrl }
      } catch (error) {
        if (!(error instanceof Error)) throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    blocked("exact Steel worker image did not become healthy")
  } catch (startupError) {
    if (!started) throw startupError
    try {
      await execute("docker", ["rm", "--force", cleanupSubject], { timeout: 15_000, maxBuffer: 1024 * 1024 })
    } catch (cleanupError) {
      throw new AggregateError([startupError, cleanupError], "exact Steel worker startup and cleanup failed")
    }
    throw startupError
  }
}

export async function readContainerBrowserVersion(containerId) {
  const result = await execFileAsync("docker", ["exec", containerId, "chromium", "--version"], { timeout: 10_000, maxBuffer: 1024 * 1024 })
  if (result.stdout.trim() === "") blocked("exact worker image returned no browser version")
  return result.stdout.trim()
}

export async function readContainerRuntimeVersion(containerId, { execute = execFileAsync } = {}) {
  const result = await execute("docker", ["exec", containerId, "node", "--version"], { timeout: 10_000, maxBuffer: 1024 * 1024 })
  if (!/^v\d+\.\d+\.\d+$/u.test(result.stdout.trim())) blocked("exact worker image returned an invalid Node runtime version")
  return result.stdout.trim()
}

export async function stopExactWorker(containerId) {
  await execFileAsync("docker", ["rm", "--force", containerId], { timeout: 15_000 })
}
