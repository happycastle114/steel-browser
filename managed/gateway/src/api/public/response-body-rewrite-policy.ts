import { assertNever } from "../../domain/exhaustive.js"
import { PublicRouteId, type PublicRouteId as PublicRouteIdValue } from "./schemas.js"

export const PublicBodyRewriteKind = {
  JSON: "JSON",
  PASSTHROUGH: "PASSTHROUGH",
  TEXT: "TEXT",
} as const
export type PublicBodyRewriteKind =
  (typeof PublicBodyRewriteKind)[keyof typeof PublicBodyRewriteKind]

export function publicBodyRewriteKind(routeId: PublicRouteIdValue): PublicBodyRewriteKind {
  switch (routeId) {
    case PublicRouteId.DOCS_OPENAPI_JSON:
    case PublicRouteId.SESSIONS_CREATE:
    case PublicRouteId.SESSIONS_GET:
    case PublicRouteId.SESSIONS_LIST:
    case PublicRouteId.SESSIONS_LIVE_DETAILS:
    case PublicRouteId.SESSIONS_RELEASE_ACTIVE:
    case PublicRouteId.SESSIONS_RELEASE_ID:
      return PublicBodyRewriteKind.JSON
    case PublicRouteId.DOCS_OPENAPI_YAML:
    case PublicRouteId.SESSIONS_DEBUG:
      return PublicBodyRewriteKind.TEXT
    case PublicRouteId.ACTION_PDF:
    case PublicRouteId.ACTION_SCRAPE:
    case PublicRouteId.ACTION_SCREENSHOT:
    case PublicRouteId.ACTION_SEARCH:
    case PublicRouteId.CDP_DEVTOOLS:
    case PublicRouteId.CORS_OPTIONS:
    case PublicRouteId.DOCS_HTML:
    case PublicRouteId.DOCS_REDIRECT:
    case PublicRouteId.DOCS_SCALAR_JS:
    case PublicRouteId.FILES_ARCHIVE:
    case PublicRouteId.FILES_DELETE:
    case PublicRouteId.FILES_DELETE_ALL:
    case PublicRouteId.FILES_DOWNLOAD:
    case PublicRouteId.FILES_HEAD:
    case PublicRouteId.FILES_LIST:
    case PublicRouteId.FILES_UPLOAD:
    case PublicRouteId.HEALTH:
    case PublicRouteId.LOGS_CLEAR:
    case PublicRouteId.LOGS_EXPORT:
    case PublicRouteId.LOGS_QUERY:
    case PublicRouteId.LOGS_STATS:
    case PublicRouteId.LOGS_STREAM:
    case PublicRouteId.SELENIUM_PROXY:
    case PublicRouteId.SESSIONS_CONTEXT:
    case PublicRouteId.SESSIONS_EVENTS:
    case PublicRouteId.SESSIONS_PDF:
    case PublicRouteId.SESSIONS_SCRAPE:
    case PublicRouteId.SESSIONS_SCREENSHOT:
      return PublicBodyRewriteKind.PASSTHROUGH
    default:
      return assertNever(routeId)
  }
}
