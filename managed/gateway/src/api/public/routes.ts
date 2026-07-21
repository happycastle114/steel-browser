import {
  PublicAffinity,
  PublicHttpMethod,
  PublicLifecycle,
  PublicRouteMethod,
  PublicRouteId,
  type PublicRoute,
} from "./schemas.js"
import { canonicalPublicPathname } from "./path-validation.js"

const R = PublicRouteId
const M = PublicRouteMethod
const A = PublicAffinity
const L = PublicLifecycle

export const PUBLIC_REST_ROUTES = [
  { id: R.ACTION_SCRAPE, method: M.POST, path: "/v1/scrape", affinity: A.UNSCOPED_ACTIVE_SESSION, lifecycle: L.ACTION, implicitHead: false },
  { id: R.ACTION_SCREENSHOT, method: M.POST, path: "/v1/screenshot", affinity: A.UNSCOPED_ACTIVE_SESSION, lifecycle: L.ACTION, implicitHead: false },
  { id: R.ACTION_PDF, method: M.POST, path: "/v1/pdf", affinity: A.UNSCOPED_ACTIVE_SESSION, lifecycle: L.ACTION, implicitHead: false },
  { id: R.ACTION_SEARCH, method: M.POST, path: "/v1/search", affinity: A.UNSCOPED_ACTIVE_SESSION, lifecycle: L.ACTION, implicitHead: false },
  { id: R.CDP_DEVTOOLS, method: M.GET, path: "/v1/devtools/inspector.html", affinity: A.UNSCOPED_ACTIVE_SESSION, lifecycle: L.DEBUG, implicitHead: true },
  { id: R.FILES_UPLOAD, method: M.POST, path: "/v1/sessions/:sessionId/files", affinity: A.PATH_SESSION_ID, lifecycle: L.FILE, implicitHead: false },
  { id: R.FILES_HEAD, method: M.HEAD, path: "/v1/sessions/:sessionId/files/*", affinity: A.PATH_SESSION_ID, lifecycle: L.FILE, implicitHead: false },
  { id: R.FILES_DOWNLOAD, method: M.GET, path: "/v1/sessions/:sessionId/files/*", affinity: A.PATH_SESSION_ID, lifecycle: L.FILE, implicitHead: true },
  { id: R.FILES_LIST, method: M.GET, path: "/v1/sessions/:sessionId/files", affinity: A.PATH_SESSION_ID, lifecycle: L.FILE, implicitHead: true },
  { id: R.FILES_DELETE, method: M.DELETE, path: "/v1/sessions/:sessionId/files/*", affinity: A.PATH_SESSION_ID, lifecycle: L.FILE, implicitHead: false },
  { id: R.FILES_DELETE_ALL, method: M.DELETE, path: "/v1/sessions/:sessionId/files", affinity: A.PATH_SESSION_ID, lifecycle: L.FILE, implicitHead: false },
  { id: R.FILES_ARCHIVE, method: M.GET, path: "/v1/sessions/:sessionId/files.zip", affinity: A.PATH_SESSION_ID, lifecycle: L.FILE, implicitHead: true },
  { id: R.LOGS_QUERY, method: M.GET, path: "/v1/logs/query", affinity: A.UNSCOPED_ACTIVE_SESSION, lifecycle: L.LOG, implicitHead: true },
  { id: R.LOGS_STATS, method: M.GET, path: "/v1/logs/stats", affinity: A.UNSCOPED_ACTIVE_SESSION, lifecycle: L.LOG, implicitHead: true },
  { id: R.LOGS_STREAM, method: M.GET, path: "/v1/logs/stream", affinity: A.UNSCOPED_ACTIVE_SESSION, lifecycle: L.LOG, implicitHead: true },
  { id: R.LOGS_EXPORT, method: M.POST, path: "/v1/logs/export", affinity: A.UNSCOPED_ACTIVE_SESSION, lifecycle: L.LOG, implicitHead: false },
  { id: R.LOGS_CLEAR, method: M.DELETE, path: "/v1/logs/", affinity: A.UNSCOPED_ACTIVE_SESSION, lifecycle: L.LOG, implicitHead: false },
  { id: R.SELENIUM_PROXY, method: M.ALL, path: "/selenium/wd/*", affinity: A.UNSCOPED_ACTIVE_SESSION, lifecycle: L.SELENIUM, implicitHead: false },
  { id: R.HEALTH, method: M.GET, path: "/v1/health", affinity: A.NONE, lifecycle: L.HEALTH, implicitHead: true },
  { id: R.SESSIONS_CREATE, method: M.POST, path: "/v1/sessions", affinity: A.CREATE, lifecycle: L.CREATE, implicitHead: false },
  { id: R.SESSIONS_LIST, method: M.GET, path: "/v1/sessions", affinity: A.NONE, lifecycle: L.READ, implicitHead: true },
  { id: R.SESSIONS_GET, method: M.GET, path: "/v1/sessions/:sessionId", affinity: A.PATH_SESSION_ID, lifecycle: L.READ, implicitHead: true },
  { id: R.SESSIONS_CONTEXT, method: M.GET, path: "/v1/sessions/:sessionId/context", affinity: A.PATH_SESSION_ID, lifecycle: L.CONTEXT, implicitHead: true },
  { id: R.SESSIONS_RELEASE_ID, method: M.POST, path: "/v1/sessions/:sessionId/release", affinity: A.PATH_SESSION_ID, lifecycle: L.RELEASE, implicitHead: false },
  { id: R.SESSIONS_RELEASE_ACTIVE, method: M.POST, path: "/v1/sessions/release", affinity: A.UNSCOPED_ACTIVE_SESSION, lifecycle: L.RELEASE, implicitHead: false },
  { id: R.SESSIONS_DEBUG, method: M.GET, path: "/v1/sessions/debug", affinity: A.UNSCOPED_ACTIVE_SESSION, lifecycle: L.DEBUG, implicitHead: true },
  { id: R.SESSIONS_EVENTS, method: M.POST, path: "/v1/events", affinity: A.UNSCOPED_ACTIVE_SESSION, lifecycle: L.EVENT, implicitHead: false },
  { id: R.SESSIONS_LIVE_DETAILS, method: M.GET, path: "/v1/sessions/:id/live-details", affinity: A.PATH_SESSION_ID, lifecycle: L.LIVE_DETAILS, implicitHead: true },
  { id: R.SESSIONS_SCRAPE, method: M.POST, path: "/v1/sessions/scrape", affinity: A.UNSCOPED_ACTIVE_SESSION, lifecycle: L.ACTION, implicitHead: false },
  { id: R.SESSIONS_SCREENSHOT, method: M.POST, path: "/v1/sessions/screenshot", affinity: A.UNSCOPED_ACTIVE_SESSION, lifecycle: L.ACTION, implicitHead: false },
  { id: R.SESSIONS_PDF, method: M.POST, path: "/v1/sessions/pdf", affinity: A.UNSCOPED_ACTIVE_SESSION, lifecycle: L.ACTION, implicitHead: false },
  { id: R.DOCS_REDIRECT, method: M.GET, path: "/documentation", affinity: A.NONE, lifecycle: L.DOCUMENTATION, implicitHead: true },
  { id: R.DOCS_HTML, method: M.GET, path: "/documentation/", affinity: A.NONE, lifecycle: L.DOCUMENTATION, implicitHead: true },
  { id: R.DOCS_OPENAPI_JSON, method: M.GET, path: "/documentation/openapi.json", affinity: A.NONE, lifecycle: L.DOCUMENTATION, implicitHead: true },
  { id: R.DOCS_OPENAPI_YAML, method: M.GET, path: "/documentation/openapi.yaml", affinity: A.NONE, lifecycle: L.DOCUMENTATION, implicitHead: true },
  { id: R.DOCS_SCALAR_JS, method: M.GET, path: "/documentation/js/scalar.js", affinity: A.NONE, lifecycle: L.DOCUMENTATION, implicitHead: true },
  { id: R.CORS_OPTIONS, method: M.OPTIONS, path: "/*", affinity: A.NONE, lifecycle: L.READ, implicitHead: false },
] as const satisfies readonly PublicRoute[]

export const PublicRouteMatchKind = {
  MATCHED: "MATCHED",
  METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
  NOT_FOUND: "NOT_FOUND",
} as const

type PublicRouteParams = Readonly<Record<string, string>>
export type PublicRouteMatch =
  | {
      readonly kind: typeof PublicRouteMatchKind.MATCHED
      readonly params: PublicRouteParams
      readonly route: PublicRoute
    }
  | {
      readonly kind: typeof PublicRouteMatchKind.METHOD_NOT_ALLOWED
      readonly allow: readonly PublicHttpMethod[]
    }
  | { readonly kind: typeof PublicRouteMatchKind.NOT_FOUND }

type PathMatch = {
  readonly params: PublicRouteParams
  readonly specificity: number
}

const ALLOW_ORDER = [
  PublicHttpMethod.GET,
  PublicHttpMethod.HEAD,
  PublicHttpMethod.POST,
  PublicHttpMethod.PUT,
  PublicHttpMethod.PATCH,
  PublicHttpMethod.DELETE,
  PublicHttpMethod.OPTIONS,
] as const

export function matchPublicRoute(
  method: PublicHttpMethod,
  pathAndQuery: string,
): PublicRouteMatch {
  const pathname = canonicalPublicPathname(pathAndQuery)
  if (pathname === undefined) return { kind: PublicRouteMatchKind.NOT_FOUND }
  if (method === M.OPTIONS) {
    const route = PUBLIC_REST_ROUTES.find(({ id }) => id === R.CORS_OPTIONS)
    return route === undefined
      ? { kind: PublicRouteMatchKind.NOT_FOUND }
      : { kind: PublicRouteMatchKind.MATCHED, params: {}, route }
  }

  const matches = PUBLIC_REST_ROUTES.flatMap((route) => {
    if (route.id === R.CORS_OPTIONS) return []
    const pathMatch = matchPath(route.path, pathname)
    return pathMatch === undefined ? [] : [{ route, pathMatch }]
  })
  const specificity = matches.reduce(
    (highest, match) => Math.max(highest, match.pathMatch.specificity),
    -1,
  )
  const mostSpecific = matches.filter((match) => match.pathMatch.specificity === specificity)
  const selected = mostSpecific.find(({ route }) => acceptsMethod(route, method))
  if (selected !== undefined) {
    return {
      kind: PublicRouteMatchKind.MATCHED,
      params: selected.pathMatch.params,
      route: selected.route,
    }
  }
  if (mostSpecific.length === 0) return { kind: PublicRouteMatchKind.NOT_FOUND }
  return {
    kind: PublicRouteMatchKind.METHOD_NOT_ALLOWED,
    allow: ALLOW_ORDER.filter((allowed) =>
      mostSpecific.some(({ route }) => acceptsMethod(route, allowed)),
    ),
  }
}

function acceptsMethod(route: PublicRoute, method: PublicHttpMethod): boolean {
  return (
    route.method === M.ALL ||
    route.method === method ||
    (method === M.HEAD && route.method === M.GET && route.implicitHead)
  )
}

function matchPath(pattern: string, pathname: string): PathMatch | undefined {
  if (!pattern.startsWith("/") || !pathname.startsWith("/")) return undefined
  const patternParts = pattern.slice(1).split("/")
  const pathParts = pathname.slice(1).split("/")
  const params: Record<string, string> = {}
  let staticSegments = 0
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index]
    if (expected === undefined) return undefined
    if (expected === "*") {
      const decoded = decode(pathParts.slice(index).join("/"))
      if (decoded === undefined) return undefined
      params["wildcard"] = decoded
      return { params, specificity: staticSegments * 1_000 + index * 10 - 1 }
    }
    const actual = pathParts[index]
    if (actual === undefined) return undefined
    if (expected.startsWith(":")) {
      const decoded = decode(actual)
      if (decoded === undefined || decoded.length === 0) return undefined
      params[expected.slice(1)] = decoded
    } else {
      if (expected !== actual) return undefined
      staticSegments += 1
    }
  }
  if (pathParts.length !== patternParts.length) return undefined
  return { params, specificity: staticSegments * 1_000 + patternParts.length * 10 }
}

function decode(value: string): string | undefined {
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}
