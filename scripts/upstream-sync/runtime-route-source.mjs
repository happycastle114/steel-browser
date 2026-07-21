import { readFile } from "node:fs/promises"
import path from "node:path"

export const PROTOCOL = Object.freeze({ REST: "REST", WEBSOCKET: "WEBSOCKET" })
export const HTTP_METHOD = Object.freeze({ ALL: "ALL", DELETE: "DELETE", GET: "GET", HEAD: "HEAD", OPTIONS: "OPTIONS", POST: "POST" })
const SOURCE_CONFIGS = Object.freeze([
  { path: "api/src/modules/actions/actions.routes.ts", prefix: "/v1" },
  { path: "api/src/modules/cdp/cdp.routes.ts", prefix: "/v1" },
  { path: "api/src/modules/files/files.routes.ts", prefix: "/v1" },
  { path: "api/src/modules/logs/logs.routes.ts", prefix: "/v1/logs" },
  { path: "api/src/modules/selenium/selenium.routes.ts", prefix: "" },
  { path: "api/src/modules/sessions/sessions.routes.ts", prefix: "/v1" },
])
const WEBSOCKET_SOURCES = Object.freeze([
  "api/src/plugins/browser-socket/handlers/cast.handler.ts",
  "api/src/plugins/browser-socket/handlers/logs.handler.ts",
  "api/src/plugins/browser-socket/handlers/pageId.handler.ts",
  "api/src/plugins/browser-socket/handlers/recording.handler.ts",
])
const PINNED_SOURCES = Object.freeze([
  "api/src/index.ts",
  ...SOURCE_CONFIGS.map((entry) => entry.path),
  "api/src/plugins/browser-socket/browser-socket.ts",
  ...WEBSOCKET_SOURCES,
  "api/src/plugins/schemas.ts",
])

function blocked(message) {
  const error = new Error(message)
  error.code = "RUNTIME_CAPTURE_BLOCKED"
  throw error
}

export const routeKey = (route) => `${route.protocol}|${route.protocol === PROTOCOL.REST ? route.method : "UPGRADE"}|${route.path}|${route.source}`

function parseMethod(value) {
  const method = value.toUpperCase()
  if (!Object.values(HTTP_METHOD).includes(method)) blocked(`unsupported runtime route method: ${value}`)
  return method
}

function joinRoutePath(prefix, routePath) {
  if (prefix === "") return routePath
  return routePath === "/" ? `${prefix}/` : `${prefix}${routePath}`
}

export async function readPinnedSources(repositoryRoot) {
  return Promise.all(PINNED_SOURCES.map(async (sourcePath) => ({ path: sourcePath, text: await readFile(path.join(repositoryRoot, sourcePath), "utf8") })))
}

export function discoverRoutes(sources) {
  const sourceByPath = new Map(sources.map((source) => [source.path, source.text]))
  const routes = []
  const routeCall = /\b(?:server|fastify)\.(all|delete|get|head|options|post)\(\s*["']([^"']+)["']/gu
  for (const config of SOURCE_CONFIGS) {
    const text = sourceByPath.get(config.path)
    if (text === undefined) blocked(`missing pinned route source: ${config.path}`)
    for (const match of text.matchAll(routeCall)) routes.push({ protocol: PROTOCOL.REST, method: parseMethod(match[1]), path: joinRoutePath(config.prefix, match[2]), source: config.path })
  }
  const schemaText = sourceByPath.get("api/src/plugins/schemas.ts")
  const indexText = sourceByPath.get("api/src/index.ts")
  if (!schemaText?.includes('routePrefix: "/documentation"') || !/(?:server|fastify)\.register\(fastifyCors/u.test(indexText ?? "")) blocked("generated documentation or CORS route registration changed")
  routes.push(
    { protocol: PROTOCOL.REST, method: HTTP_METHOD.GET, path: "/documentation", source: "api/src/plugins/schemas.ts" },
    { protocol: PROTOCOL.REST, method: HTTP_METHOD.GET, path: "/documentation/", source: "api/src/plugins/schemas.ts" },
    { protocol: PROTOCOL.REST, method: HTTP_METHOD.GET, path: "/documentation/openapi.json", source: "api/src/plugins/schemas.ts" },
    { protocol: PROTOCOL.REST, method: HTTP_METHOD.GET, path: "/documentation/openapi.yaml", source: "api/src/plugins/schemas.ts" },
    { protocol: PROTOCOL.REST, method: HTTP_METHOD.GET, path: "/documentation/js/scalar.js", source: "api/src/plugins/schemas.ts" },
    { protocol: PROTOCOL.REST, method: HTTP_METHOD.OPTIONS, path: "/*", source: "api/src/index.ts" },
  )
  for (const sourcePath of WEBSOCKET_SOURCES) {
    const matches = [...(sourceByPath.get(sourcePath) ?? "").matchAll(/\bpath:\s*["']([^"']+)["']/gu)]
    if (matches.length !== 1) blocked(`expected one WebSocket path in ${sourcePath}`)
    routes.push({ protocol: PROTOCOL.WEBSOCKET, path: matches[0][1], source: sourcePath })
  }
  if (!sourceByPath.get("api/src/plugins/browser-socket/browser-socket.ts")?.includes("registry.matchHandler(url)")) blocked("CDP fallback upgrade registration changed")
  routes.push({ protocol: PROTOCOL.WEBSOCKET, path: "/", source: "api/src/plugins/browser-socket/browser-socket.ts" })
  return routes.sort((left, right) => routeKey(left).localeCompare(routeKey(right)))
}

export function bindReviewedRoutePlan(discovered, plan) {
  if (plan === null || typeof plan !== "object" || Array.isArray(plan) || plan.schemaVersion !== 1 || !Array.isArray(plan.routes) || plan.runtimeProfile?.nodeEnv !== "development" || plan.runtimeProfile?.logStorageEnabled !== true) blocked("reviewed runtime capture plan is invalid")
  const discoveredKeys = discovered.map(routeKey)
  const planKeys = plan.routes.map(routeKey).sort((left, right) => left.localeCompare(right))
  if (JSON.stringify(discoveredKeys) !== JSON.stringify(planKeys)) blocked("candidate runtime routes drift from the reviewed compatibility plan")
  if (plan.routes.filter((route) => route.protocol === PROTOCOL.REST).length !== 37 || plan.routes.filter((route) => route.protocol === PROTOCOL.WEBSOCKET).length !== 5) blocked("reviewed compatibility plan is not the exact 37 REST and 5 WebSocket contract")
  return structuredClone(plan.routes)
}
