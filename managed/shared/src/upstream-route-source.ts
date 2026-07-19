import { HTTP_METHOD, PROTOCOL_KIND } from "./upstream-corpus-model.js"

export const PINNED_ROUTE_SOURCE_PATHS = [
  "api/src/index.ts",
  "api/src/modules/actions/actions.routes.ts",
  "api/src/modules/cdp/cdp.routes.ts",
  "api/src/modules/files/files.routes.ts",
  "api/src/modules/logs/logs.routes.ts",
  "api/src/modules/selenium/selenium.routes.ts",
  "api/src/modules/sessions/sessions.routes.ts",
  "api/src/plugins/browser-socket/browser-socket.ts",
  "api/src/plugins/browser-socket/handlers/cast.handler.ts",
  "api/src/plugins/browser-socket/handlers/logs.handler.ts",
  "api/src/plugins/browser-socket/handlers/pageId.handler.ts",
  "api/src/plugins/browser-socket/handlers/recording.handler.ts",
  "api/src/plugins/schemas.ts",
] as const

const REST_SOURCE_CONFIGS = [
  { path: "api/src/modules/actions/actions.routes.ts", prefix: "/v1" },
  { path: "api/src/modules/cdp/cdp.routes.ts", prefix: "/v1" },
  { path: "api/src/modules/files/files.routes.ts", prefix: "/v1" },
  { path: "api/src/modules/logs/logs.routes.ts", prefix: "/v1/logs" },
  { path: "api/src/modules/selenium/selenium.routes.ts", prefix: "" },
  { path: "api/src/modules/sessions/sessions.routes.ts", prefix: "/v1" },
] as const

const WEBSOCKET_SOURCE_PATHS = [
  "api/src/plugins/browser-socket/handlers/cast.handler.ts",
  "api/src/plugins/browser-socket/handlers/logs.handler.ts",
  "api/src/plugins/browser-socket/handlers/pageId.handler.ts",
  "api/src/plugins/browser-socket/handlers/recording.handler.ts",
] as const

type SourceText = {
  readonly path: string
  readonly text: string
}

export type DiscoveredRoute = {
  readonly protocol: "REST" | "WEBSOCKET"
  readonly method: "ALL" | "DELETE" | "GET" | "HEAD" | "OPTIONS" | "POST" | "UPGRADE"
  readonly path: string
  readonly source: string
}

export class UpstreamRouteSourceError extends Error {
  override readonly name = "UpstreamRouteSourceError"

  constructor(readonly detail: string) {
    super(detail)
  }
}

function getSource(sources: readonly SourceText[], path: string): string {
  const source = sources.find((candidate) => candidate.path === path)
  if (source === undefined) {
    throw new UpstreamRouteSourceError(`missing pinned route source: ${path}`)
  }
  return source.text
}

function parseMethod(value: string): DiscoveredRoute["method"] {
  switch (value) {
    case "all":
      return HTTP_METHOD.ALL
    case "delete":
      return HTTP_METHOD.DELETE
    case "get":
      return HTTP_METHOD.GET
    case "head":
      return HTTP_METHOD.HEAD
    case "options":
      return HTTP_METHOD.OPTIONS
    case "post":
      return HTTP_METHOD.POST
    default:
      throw new UpstreamRouteSourceError(`unsupported route method: ${value}`)
  }
}

function joinRoutePath(prefix: string, routePath: string): string {
  if (prefix.length === 0) {
    return routePath
  }
  if (routePath === "/") {
    return `${prefix}/`
  }
  return `${prefix}${routePath}`
}

function extractRestRoutes(sources: readonly SourceText[]): readonly DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = []
  const routeCall = /\b(?:server|fastify)\.(all|delete|get|head|options|post)\(\s*["']([^"']+)["']/gu

  for (const config of REST_SOURCE_CONFIGS) {
    const text = getSource(sources, config.path)
    for (const match of text.matchAll(routeCall)) {
      const method = match[1]
      const routePath = match[2]
      if (method === undefined || routePath === undefined) {
        throw new UpstreamRouteSourceError(`unparseable route call in ${config.path}`)
      }
      routes.push({
        protocol: PROTOCOL_KIND.REST,
        method: parseMethod(method),
        path: joinRoutePath(config.prefix, routePath),
        source: config.path,
      })
    }
  }
  return routes
}

function extractWebSocketRoutes(sources: readonly SourceText[]): readonly DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = []
  const handlerPath = /\bpath:\s*["']([^"']+)["']/gu

  for (const path of WEBSOCKET_SOURCE_PATHS) {
    const text = getSource(sources, path)
    const matches = [...text.matchAll(handlerPath)]
    if (matches.length !== 1) {
      throw new UpstreamRouteSourceError(`expected one WebSocket path in ${path}`)
    }
    const routePath = matches[0]?.[1]
    if (routePath === undefined) {
      throw new UpstreamRouteSourceError(`unparseable WebSocket path in ${path}`)
    }
    routes.push({
      protocol: PROTOCOL_KIND.WEBSOCKET,
      method: "UPGRADE",
      path: routePath,
      source: path,
    })
  }

  const fallbackSource = "api/src/plugins/browser-socket/browser-socket.ts"
  const fallbackText = getSource(sources, fallbackSource)
  if (!fallbackText.includes("registry.matchHandler(url)")) {
    throw new UpstreamRouteSourceError("CDP fallback upgrade registration is missing")
  }
  routes.push({
    protocol: PROTOCOL_KIND.WEBSOCKET,
    method: "UPGRADE",
    path: "/",
    source: fallbackSource,
  })
  return routes
}

function generatedRuntimeRoutes(sources: readonly SourceText[]): readonly DiscoveredRoute[] {
  const schemaSource = "api/src/plugins/schemas.ts"
  const schemaText = getSource(sources, schemaSource)
  if (!schemaText.includes('routePrefix: "/documentation"')) {
    throw new UpstreamRouteSourceError("documentation route prefix changed")
  }
  const indexSource = "api/src/index.ts"
  const indexText = getSource(sources, indexSource)
  if (!/(?:server|fastify)\.register\(fastifyCors/u.test(indexText)) {
    throw new UpstreamRouteSourceError("CORS registration changed")
  }
  return [
    { protocol: PROTOCOL_KIND.REST, method: HTTP_METHOD.GET, path: "/documentation", source: schemaSource },
    { protocol: PROTOCOL_KIND.REST, method: HTTP_METHOD.GET, path: "/documentation/", source: schemaSource },
    { protocol: PROTOCOL_KIND.REST, method: HTTP_METHOD.GET, path: "/documentation/openapi.json", source: schemaSource },
    { protocol: PROTOCOL_KIND.REST, method: HTTP_METHOD.GET, path: "/documentation/openapi.yaml", source: schemaSource },
    { protocol: PROTOCOL_KIND.REST, method: HTTP_METHOD.GET, path: "/documentation/js/scalar.js", source: schemaSource },
    { protocol: PROTOCOL_KIND.REST, method: HTTP_METHOD.OPTIONS, path: "/*", source: indexSource },
  ]
}

export function discoverPinnedRuntimeRoutes(
  sources: readonly SourceText[],
): readonly DiscoveredRoute[] {
  return [
    ...extractRestRoutes(sources),
    ...generatedRuntimeRoutes(sources),
    ...extractWebSocketRoutes(sources),
  ].sort((left, right) => routeKey(left).localeCompare(routeKey(right)))
}

export function routeKey(route: DiscoveredRoute): string {
  return `${route.protocol}|${route.method}|${route.path}|${route.source}`
}
