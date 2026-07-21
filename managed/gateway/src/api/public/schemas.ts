import type { Readable } from "node:stream"
import { z } from "zod"
import {
  AFFINITY_RULE,
  HTTP_METHOD,
  LIFECYCLE_CLASS,
} from "@happycastle/steel-managed-shared"
import type { PublicSessionId } from "../../domain/ids.js"

export const MANAGED_API_VERSION = "2026-07-01"

export const PublicHttpMethod = {
  DELETE: HTTP_METHOD.DELETE,
  GET: HTTP_METHOD.GET,
  HEAD: HTTP_METHOD.HEAD,
  OPTIONS: HTTP_METHOD.OPTIONS,
  PATCH: "PATCH",
  POST: HTTP_METHOD.POST,
  PUT: "PUT",
} as const
export type PublicHttpMethod = (typeof PublicHttpMethod)[keyof typeof PublicHttpMethod]
export const PublicHttpMethodSchema = z.enum([
  PublicHttpMethod.DELETE,
  PublicHttpMethod.GET,
  PublicHttpMethod.HEAD,
  PublicHttpMethod.OPTIONS,
  PublicHttpMethod.PATCH,
  PublicHttpMethod.POST,
  PublicHttpMethod.PUT,
])

export const PublicRouteMethod = HTTP_METHOD
export type PublicRouteMethod = (typeof PublicRouteMethod)[keyof typeof PublicRouteMethod]

export const PublicAffinity = AFFINITY_RULE
export type PublicAffinity = (typeof PublicAffinity)[keyof typeof PublicAffinity]

export const PublicLifecycle = LIFECYCLE_CLASS
export type PublicLifecycle = (typeof PublicLifecycle)[keyof typeof PublicLifecycle]

export const PublicRouteId = {
  ACTION_PDF: "rest.action.pdf",
  ACTION_SCRAPE: "rest.action.scrape",
  ACTION_SCREENSHOT: "rest.action.screenshot",
  ACTION_SEARCH: "rest.action.search",
  CDP_DEVTOOLS: "rest.cdp.devtools",
  CORS_OPTIONS: "rest.cors.options",
  DOCS_HTML: "rest.docs.html",
  DOCS_OPENAPI_JSON: "rest.docs.openapi-json",
  DOCS_OPENAPI_YAML: "rest.docs.openapi-yaml",
  DOCS_REDIRECT: "rest.docs.redirect",
  DOCS_SCALAR_JS: "rest.docs.scalar-js",
  FILES_ARCHIVE: "rest.files.archive",
  FILES_DELETE: "rest.files.delete",
  FILES_DELETE_ALL: "rest.files.delete-all",
  FILES_DOWNLOAD: "rest.files.download",
  FILES_HEAD: "rest.files.head",
  FILES_LIST: "rest.files.list",
  FILES_UPLOAD: "rest.files.upload",
  HEALTH: "rest.health",
  LOGS_CLEAR: "rest.logs.clear",
  LOGS_EXPORT: "rest.logs.export",
  LOGS_QUERY: "rest.logs.query",
  LOGS_STATS: "rest.logs.stats",
  LOGS_STREAM: "rest.logs.stream",
  SELENIUM_PROXY: "rest.selenium.proxy",
  SESSIONS_CONTEXT: "rest.sessions.context",
  SESSIONS_CREATE: "rest.sessions.create",
  SESSIONS_DEBUG: "rest.sessions.debug",
  SESSIONS_EVENTS: "rest.sessions.events",
  SESSIONS_GET: "rest.sessions.get",
  SESSIONS_LIST: "rest.sessions.list",
  SESSIONS_LIVE_DETAILS: "rest.sessions.live-details",
  SESSIONS_PDF: "rest.sessions.pdf",
  SESSIONS_RELEASE_ACTIVE: "rest.sessions.release-active",
  SESSIONS_RELEASE_ID: "rest.sessions.release-id",
  SESSIONS_SCRAPE: "rest.sessions.scrape",
  SESSIONS_SCREENSHOT: "rest.sessions.screenshot",
} as const
export type PublicRouteId = (typeof PublicRouteId)[keyof typeof PublicRouteId]

export const PublicOriginSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value)
    return (
      url.protocol === "https:" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      url.username === "" &&
      url.password === ""
    )
  })
  .brand("PublicOrigin")
export type PublicOrigin = z.infer<typeof PublicOriginSchema>

export type PublicRoute = {
  readonly affinity: PublicAffinity
  readonly id: PublicRouteId
  readonly implicitHead: boolean
  readonly lifecycle: PublicLifecycle
  readonly method: PublicRouteMethod
  readonly path: string
}

export type UpstreamHttpResponse = {
  readonly statusCode: number
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>
  readonly body: Buffer
}

export type PublicHttpResponse = UpstreamHttpResponse

export type PublicStreamingHttpResponse = {
  readonly body: Readable
  readonly cancel: () => void
  readonly closed: Promise<void>
  readonly headers: UpstreamHttpResponse["headers"]
  readonly statusCode: number
  readonly streaming: true
}

export type PublicGatewayResponse = PublicHttpResponse | PublicStreamingHttpResponse

export type PublicResponseRewriteInput = {
  readonly publicOrigin: string
  readonly requestMethod: PublicHttpMethod
  readonly routeId: PublicRouteId
  readonly sessionId?: PublicSessionId
  readonly upstreamOrigin: string
  readonly response: UpstreamHttpResponse
}
