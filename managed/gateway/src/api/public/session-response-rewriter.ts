import { z } from "zod"
import { assertNever } from "../../domain/exhaustive.js"
import { PublicSessionIdSchema, type PublicSessionId } from "../../domain/ids.js"
import {
  PublicOriginSchema,
  PublicRouteId,
  type PublicResponseRewriteInput,
} from "./schemas.js"
import { PublicResponseRewriteError } from "./response-safety.js"
import { rewriteOpenApiDocument } from "./url-rewrite-transforms.js"

const UnknownObjectSchema = z.record(z.unknown())

function sessionUrl(origin: URL, path: string, sessionId: PublicSessionId): string {
  const url = new URL(path, origin)
  url.searchParams.set("sessionId", sessionId)
  return url.toString()
}

function webSocketUrl(origin: URL, path: string, sessionId: PublicSessionId): string {
  const url = new URL(path, origin)
  url.protocol = "wss:"
  url.searchParams.set("sessionId", sessionId)
  return url.toString()
}

function castWebSocketUrl(origin: URL, sessionId: PublicSessionId): string {
  const url = new URL(`/v1/sessions/${encodeURIComponent(sessionId)}/cast`, origin)
  url.protocol = "wss:"
  return url.toString()
}

function viewerUrl(origin: URL, sessionId: PublicSessionId, fullscreen: boolean): string {
  const url = new URL(`/ui/sessions/${encodeURIComponent(sessionId)}/live`, origin)
  if (fullscreen) url.searchParams.set("showControls", "false")
  return url.toString()
}

function rewriteSessionObject(
  value: unknown,
  publicOrigin: URL,
  sessionId: PublicSessionId,
  castTransport = false,
): Readonly<Record<string, unknown>> {
  const body = UnknownObjectSchema.parse(value)
  return {
    ...body,
    ...(body["websocketUrl"] === undefined
      ? {}
      : {
          websocketUrl: castTransport
            ? castWebSocketUrl(publicOrigin, sessionId)
            : webSocketUrl(publicOrigin, "/", sessionId),
        }),
    ...(body["debugUrl"] === undefined
      ? {}
      : { debugUrl: sessionUrl(publicOrigin, "/v1/sessions/debug", sessionId) }),
    ...(body["debuggerUrl"] === undefined
      ? {}
      : { debuggerUrl: sessionUrl(publicOrigin, "/v1/devtools/inspector.html", sessionId) }),
    ...(body["sessionViewerUrl"] === undefined
      ? {}
      : { sessionViewerUrl: viewerUrl(publicOrigin, sessionId, false) }),
    ...(body["sessionViewerFullscreenUrl"] === undefined
      ? {}
      : { sessionViewerFullscreenUrl: viewerUrl(publicOrigin, sessionId, true) }),
  }
}

function requireSessionId(sessionId: PublicSessionId | undefined): PublicSessionId {
  if (sessionId === undefined) throw new PublicResponseRewriteError("session URL missing affinity")
  return sessionId
}

export function rewriteJsonBody(input: PublicResponseRewriteInput, parsed: unknown): unknown {
  const publicOrigin = new URL(PublicOriginSchema.parse(input.publicOrigin))
  switch (input.routeId) {
    case PublicRouteId.SESSIONS_CREATE:
    case PublicRouteId.SESSIONS_GET:
    case PublicRouteId.SESSIONS_RELEASE_ACTIVE:
    case PublicRouteId.SESSIONS_RELEASE_ID:
      return rewriteSessionObject(parsed, publicOrigin, requireSessionId(input.sessionId))
    case PublicRouteId.SESSIONS_LIVE_DETAILS:
      return rewriteSessionObject(parsed, publicOrigin, requireSessionId(input.sessionId), true)
    case PublicRouteId.SESSIONS_LIST: {
      const body = UnknownObjectSchema.parse(parsed)
      const sessions = z.array(UnknownObjectSchema).parse(body["sessions"])
      return {
        ...body,
        sessions: sessions.map((session) =>
          rewriteSessionObject(
            session,
            publicOrigin,
            PublicSessionIdSchema.parse(session["id"]),
          ),
        ),
      }
    }
    case PublicRouteId.DOCS_OPENAPI_JSON:
      return rewriteOpenApiDocument(parsed, publicOrigin)
    case PublicRouteId.ACTION_PDF:
    case PublicRouteId.ACTION_SCRAPE:
    case PublicRouteId.ACTION_SCREENSHOT:
    case PublicRouteId.ACTION_SEARCH:
    case PublicRouteId.CDP_DEVTOOLS:
    case PublicRouteId.CORS_OPTIONS:
    case PublicRouteId.DOCS_HTML:
    case PublicRouteId.DOCS_OPENAPI_YAML:
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
    case PublicRouteId.SESSIONS_DEBUG:
    case PublicRouteId.SESSIONS_EVENTS:
    case PublicRouteId.SESSIONS_PDF:
    case PublicRouteId.SESSIONS_SCRAPE:
    case PublicRouteId.SESSIONS_SCREENSHOT:
      return parsed
    default:
      return assertNever(input.routeId)
  }
}
