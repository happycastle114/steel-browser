import { z } from "zod"
import type { PublicSessionId } from "../../domain/ids.js"
import { PublicOriginSchema, PublicRouteId, type PublicResponseRewriteInput } from "./schemas.js"

export class PublicUrlTransformError extends Error {
  public override readonly name = "PublicUrlTransformError"
}

const OpenApiDocumentSchema = z
  .object({
    servers: z.array(z.object({ url: z.string() }).passthrough()).min(1),
  })
  .passthrough()

export function rewriteOpenApiDocument(parsed: unknown, publicOrigin: URL): unknown {
  const document = OpenApiDocumentSchema.parse(parsed)
  return {
    ...document,
    servers: document.servers.map((server, index) =>
      index === 0 ? { ...server, url: new URL("/", publicOrigin).toString() } : server,
    ),
  }
}

export function rewriteTypedTextBody(input: PublicResponseRewriteInput): Buffer {
  switch (input.routeId) {
    case PublicRouteId.SESSIONS_DEBUG:
      return rewriteDebugHtml(input)
    case PublicRouteId.DOCS_OPENAPI_YAML:
      return rewriteOpenApiYaml(input)
    default:
      return input.response.body
  }
}

export function rewriteTypedHeaders(
  input: PublicResponseRewriteInput,
): Readonly<Record<string, string | readonly string[] | undefined>> {
  if (input.routeId !== PublicRouteId.CDP_DEVTOOLS) return input.response.headers
  const rawLocation = input.response.headers["location"]
  if (typeof rawLocation !== "string") {
    throw new PublicUrlTransformError("CDP response location was invalid")
  }
  return {
    ...input.response.headers,
    location: rewriteDevtoolsLocation(
      rawLocation,
      new URL(PublicOriginSchema.parse(input.publicOrigin)),
      new URL(input.upstreamOrigin),
      requireSessionId(input.sessionId),
    ),
  }
}

function rewriteDebugHtml(input: PublicResponseRewriteInput): Buffer {
  const upstream = new URL(input.upstreamOrigin)
  const publicOrigin = new URL(PublicOriginSchema.parse(input.publicOrigin))
  const sessionId = requireSessionId(input.sessionId)
  const upstreamCast = `ws://${upstream.host}/v1/sessions/cast`
  const publicCast = new URL(
    `/v1/sessions/${encodeURIComponent(sessionId)}/cast`,
    publicOrigin,
  )
  publicCast.protocol = "wss:"
  return Buffer.from(
    input.response.body.toString("utf8").replaceAll(upstreamCast, publicCast.toString()),
  )
}

function rewriteOpenApiYaml(input: PublicResponseRewriteInput): Buffer {
  const upstreamUrl = `${input.upstreamOrigin}/`
  const publicUrl = new URL("/", PublicOriginSchema.parse(input.publicOrigin)).toString()
  const text = input.response.body.toString("utf8")
  return Buffer.from(
    text
      .replace(`url: ${upstreamUrl}`, `url: ${publicUrl}`)
      .replace(`url: "${upstreamUrl}"`, `url: "${publicUrl}"`)
      .replace(`url: '${upstreamUrl}'`, `url: '${publicUrl}'`),
  )
}

function rewriteDevtoolsLocation(
  rawLocation: string,
  publicOrigin: URL,
  upstreamOrigin: URL,
  sessionId: PublicSessionId,
): string {
  const location = new URL(rawLocation)
  if (location.origin !== upstreamOrigin.origin) {
    throw new PublicUrlTransformError("CDP location origin mismatched")
  }
  const rawWebSocket = location.searchParams.get("ws")
  if (rawWebSocket === null) throw new PublicUrlTransformError("CDP websocket location was absent")
  const webSocket = new URL(
    rawWebSocket.startsWith("//") ? `${upstreamOrigin.protocol}${rawWebSocket}` : rawWebSocket,
  )
  if (webSocket.host !== upstreamOrigin.host) {
    throw new PublicUrlTransformError("CDP websocket authority mismatched")
  }
  webSocket.hostname = publicOrigin.hostname
  webSocket.port = publicOrigin.port
  webSocket.searchParams.set("sessionId", sessionId)
  location.protocol = publicOrigin.protocol
  location.hostname = publicOrigin.hostname
  location.port = publicOrigin.port
  location.searchParams.set("ws", `//${webSocket.host}${webSocket.pathname}${webSocket.search}`)
  return location.toString()
}

function requireSessionId(sessionId: PublicSessionId | undefined): PublicSessionId {
  if (sessionId === undefined) throw new PublicUrlTransformError("session URL missing affinity")
  return sessionId
}
