import { z } from "zod"

import { ResultIdSchema, SessionIdSchema, type ResultId, type SessionId } from "./control-plane-primitives.js"

const INTERNAL_HOST_SUFFIXES: readonly string[] = [
  ".cluster.local", ".example", ".internal", ".home.arpa", ".invalid", ".lan",
  ".local", ".localhost", ".localdomain", ".onion", ".test",
]
const URL_PROTOCOL = { HTTPS: "https:", WSS: "wss:" } as const
const UUID_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
const UUID_V4_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
const ROUTE_PATTERN = {
  SESSION_VIEWER: /^\/ui\/sessions\/([^/]+)\/live$/u,
  SESSION_CAST: /^\/v1\/sessions\/([^/]+)\/cast$/u,
  RESULT: /^\/v1\/results\/([^/]+)$/u,
} as const
const PUBLIC_PATH = {
  session: (sessionId: SessionId) => `/?sessionId=${sessionId}`,
  debug: (sessionId: SessionId) => `/v1/sessions/debug?sessionId=${sessionId}`,
  viewer: (sessionId: SessionId) => `/ui/sessions/${sessionId}/live`,
  cast: (sessionId: SessionId) => `/v1/sessions/${sessionId}/cast`,
  result: (resultId: ResultId) => `/v1/results/${resultId}`,
} as const

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

function isPublicHostname(hostnameInput: string): boolean {
  const hostname = hostnameInput.replace(/^\[|\]$/gu, "").toLowerCase()
  const isIpAddress = hostname.includes(":") || /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/u.test(hostname)
  if (isIpAddress || hostname === "localhost" || !hostname.includes(".")) return false
  if (INTERNAL_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return false
  const firstLabel = hostname.split(".")[0]
  return firstLabel !== "worker" && firstLabel !== "manager" &&
    !/^worker-\d+$/u.test(firstLabel ?? "") && !/^manager-\d+$/u.test(firstLabel ?? "")
}

function hostOnlyHttps(value: string): boolean {
  const url = parseUrl(value)
  return url !== undefined && url.protocol === URL_PROTOCOL.HTTPS && url.username === "" &&
    url.password === "" && url.port === "" && isPublicHostname(url.hostname) &&
    url.origin === value && url.pathname === "/" && url.search === "" && url.hash === ""
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}

function exactUrlPattern(origin: string, protocol: string, pathSource: string): RegExp {
  const host = new URL(origin).host
  return new RegExp(`^${escapePattern(`${protocol}//${host}`)}${pathSource}$`, "u")
}

export const PublicOriginSchema = z.string().url().refine(hostOnlyHttps).brand("PublicOrigin")
const SelectedPublicOriginSchema = PublicOriginSchema.brand("SelectedPublicOrigin")

export type PublicOrigin = z.infer<typeof PublicOriginSchema>
export type SelectedPublicOrigin = z.infer<typeof SelectedPublicOriginSchema>

export function createPublicUrlSchemas(originInput: SelectedPublicOrigin) {
  return Object.freeze({
    SessionWebSocketUrlSchema: z.string().url().regex(exactUrlPattern(
      originInput, URL_PROTOCOL.WSS, `/\\?sessionId=${UUID_SOURCE}`,
    )).brand("SessionWebSocketUrl"),
    SessionDebugUrlSchema: z.string().url().regex(exactUrlPattern(
      originInput, URL_PROTOCOL.HTTPS, `/v1/sessions/debug\\?sessionId=${UUID_SOURCE}`,
    )).brand("SessionDebugUrl"),
    ViewerUrlSchema: z.string().url().regex(exactUrlPattern(
      originInput, URL_PROTOCOL.HTTPS, `/ui/sessions/${UUID_SOURCE}/live`,
    )).brand("ViewerUrl"),
    CastWebSocketUrlSchema: z.string().url().regex(exactUrlPattern(
      originInput, URL_PROTOCOL.WSS, `/v1/sessions/${UUID_SOURCE}/cast`,
    )).brand("CastWebSocketUrl"),
    ResultDownloadUrlSchema: z.string().url().regex(exactUrlPattern(
      originInput, URL_PROTOCOL.HTTPS, `/v1/results/${UUID_V4_SOURCE}`,
    )).brand("ResultDownloadUrl"),
  })
}

type PublicUrlSchemas = ReturnType<typeof createPublicUrlSchemas>
export type SessionWebSocketUrl = z.infer<PublicUrlSchemas["SessionWebSocketUrlSchema"]>
export type SessionDebugUrl = z.infer<PublicUrlSchemas["SessionDebugUrlSchema"]>
export type ViewerUrl = z.infer<PublicUrlSchemas["ViewerUrlSchema"]>
export type CastWebSocketUrl = z.infer<PublicUrlSchemas["CastWebSocketUrlSchema"]>
export type ResultDownloadUrl = z.infer<PublicUrlSchemas["ResultDownloadUrlSchema"]>
export type LiveViewUrls = Readonly<{ readonly viewerUrl: ViewerUrl; readonly castWebSocketUrl: CastWebSocketUrl }>
export type SessionUrls = Readonly<{
  readonly websocketUrl: SessionWebSocketUrl
  readonly debugUrl: SessionDebugUrl
  readonly viewerUrl: ViewerUrl
}>
export type LiveViewUrlBinding = Readonly<{ readonly host: string; readonly sessionId: SessionId }>
export type SessionUrlBinding = Readonly<{ readonly host: string; readonly sessionId: SessionId }>

function bindSessionUrl(value: string, routePattern: RegExp): SessionUrlBinding {
  const url = new URL(value)
  return { host: url.host, sessionId: SessionIdSchema.parse(routePattern.exec(url.pathname)?.[1]) }
}

function bindSessionQueryUrl(value: string): SessionUrlBinding {
  const url = new URL(value)
  return { host: url.host, sessionId: SessionIdSchema.parse(url.searchParams.get("sessionId")) }
}

export function parseResultDownloadUrlId(resultDownloadUrlInput: ResultDownloadUrl): ResultId {
  const url = new URL(resultDownloadUrlInput)
  return ResultIdSchema.parse(ROUTE_PATTERN.RESULT.exec(url.pathname)?.[1])
}

export function parseLiveViewUrlBinding(
  viewerUrlInput: ViewerUrl,
  castWebSocketUrlInput: CastWebSocketUrl,
): LiveViewUrlBinding {
  const viewer = bindSessionUrl(viewerUrlInput, ROUTE_PATTERN.SESSION_VIEWER)
  const cast = bindSessionUrl(castWebSocketUrlInput, ROUTE_PATTERN.SESSION_CAST)
  if (viewer.host !== cast.host || viewer.sessionId !== cast.sessionId) {
    throw new TypeError("live-view URLs must bind the same Host and session")
  }
  return viewer
}

export function parseSessionUrlBinding(urls: Readonly<{
  readonly websocketUrl: SessionWebSocketUrl
  readonly debugUrl?: SessionDebugUrl | undefined
  readonly viewerUrl?: ViewerUrl | undefined
}>): SessionUrlBinding {
  const websocket = bindSessionQueryUrl(urls.websocketUrl)
  const bindings = [
    urls.debugUrl === undefined ? undefined : bindSessionQueryUrl(urls.debugUrl),
    urls.viewerUrl === undefined ? undefined : bindSessionUrl(urls.viewerUrl, ROUTE_PATTERN.SESSION_VIEWER),
  ]
  if (bindings.some((binding) => binding !== undefined &&
    (binding.host !== websocket.host || binding.sessionId !== websocket.sessionId))) {
    throw new TypeError("session URLs must bind the same Host and session")
  }
  return websocket
}

function normalizeHost(input: string): string {
  const url = new URL(`https://${input}`)
  if (url.username !== "" || url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new TypeError("Host must not contain credentials, path, query, or fragment")
  }
  if (url.port !== "" && url.port !== "443") throw new TypeError("Host port must be default HTTPS")
  if (!isPublicHostname(url.hostname)) throw new TypeError("Host must be a public hostname")
  return url.hostname.toLowerCase()
}

export function selectPublicOrigin(hostInput: string, originByHost: Readonly<Record<string, string>>): SelectedPublicOrigin {
  const host = normalizeHost(hostInput)
  const selected = originByHost[host]
  if (selected === undefined) throw new TypeError("Host is not allowlisted")
  const origin = SelectedPublicOriginSchema.parse(selected)
  if (new URL(origin).hostname !== host) throw new TypeError("origin does not match Host")
  return origin
}

export function selectConfiguredPublicOrigin(
  hostInput: string,
  config: Readonly<{ readonly publicOriginByHost: Readonly<Record<string, string>> }>,
): SelectedPublicOrigin {
  return selectPublicOrigin(hostInput, config.publicOriginByHost)
}

export function buildLiveViewUrls(originInput: SelectedPublicOrigin, sessionIdInput: SessionId): LiveViewUrls {
  const schemas = createPublicUrlSchemas(originInput)
  const castUrl = new URL(PUBLIC_PATH.cast(sessionIdInput), originInput)
  castUrl.protocol = URL_PROTOCOL.WSS
  return {
    viewerUrl: schemas.ViewerUrlSchema.parse(new URL(PUBLIC_PATH.viewer(sessionIdInput), originInput).href),
    castWebSocketUrl: schemas.CastWebSocketUrlSchema.parse(castUrl.href),
  }
}

export function buildSessionUrls(originInput: SelectedPublicOrigin, sessionIdInput: SessionId): SessionUrls {
  const schemas = createPublicUrlSchemas(originInput)
  const websocketUrl = new URL(PUBLIC_PATH.session(sessionIdInput), originInput)
  websocketUrl.protocol = URL_PROTOCOL.WSS
  return {
    websocketUrl: schemas.SessionWebSocketUrlSchema.parse(websocketUrl.href),
    debugUrl: schemas.SessionDebugUrlSchema.parse(new URL(PUBLIC_PATH.debug(sessionIdInput), originInput).href),
    viewerUrl: schemas.ViewerUrlSchema.parse(new URL(PUBLIC_PATH.viewer(sessionIdInput), originInput).href),
  }
}

export function buildResultDownloadUrl(originInput: SelectedPublicOrigin, resultIdInput: ResultId): ResultDownloadUrl {
  const schema = createPublicUrlSchemas(originInput).ResultDownloadUrlSchema
  return schema.parse(new URL(PUBLIC_PATH.result(resultIdInput), originInput).href)
}
