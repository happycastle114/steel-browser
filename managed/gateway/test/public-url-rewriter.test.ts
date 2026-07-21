import { describe, expect, it } from "vitest"
import {
  PublicHttpMethod,
  PublicRouteId,
  type UpstreamHttpResponse,
} from "../src/api/public/schemas.js"
import { rewritePublicResponse } from "../src/api/public/url-rewriter.js"
import { publicSessionId } from "./test-support.js"

const INTERNAL_ORIGIN = "http://worker-00:3000"
const PUBLIC_ORIGIN = "https://candidate.steel.example"

function response(body: unknown): UpstreamHttpResponse {
  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "transfer-encoding": "chunked",
      "x-managed-worker-id": "worker-00",
      "x-upstream-additive": "preserved",
    },
    body: Buffer.from(JSON.stringify(body)),
  }
}

describe("rewritePublicResponse", () => {
  it("rewrites only typed session URL fields onto the selected public slot", () => {
    // Given
    const sessionId = publicSessionId(1)
    const upstream = response({
      id: sessionId,
      status: "live",
      websocketUrl: `${INTERNAL_ORIGIN.replace("http:", "ws:")}/`,
      debugUrl: `${INTERNAL_ORIGIN}/v1/sessions/debug`,
      debuggerUrl: `${INTERNAL_ORIGIN}/v1/devtools/inspector.html`,
      sessionViewerUrl: `${INTERNAL_ORIGIN}/`,
      additive: { retained: true },
    })

    // When
    const rewritten = rewritePublicResponse({
      publicOrigin: PUBLIC_ORIGIN,
      requestMethod: PublicHttpMethod.GET,
      routeId: PublicRouteId.SESSIONS_GET,
      sessionId,
      upstreamOrigin: INTERNAL_ORIGIN,
      response: upstream,
    })

    // Then
    expect(JSON.parse(rewritten.body.toString("utf8"))).toEqual({
      id: sessionId,
      status: "live",
      websocketUrl: `${PUBLIC_ORIGIN.replace("https:", "wss:")}/?sessionId=${sessionId}`,
      debugUrl: `${PUBLIC_ORIGIN}/v1/sessions/debug?sessionId=${sessionId}`,
      debuggerUrl: `${PUBLIC_ORIGIN}/v1/devtools/inspector.html?sessionId=${sessionId}`,
      sessionViewerUrl: `${PUBLIC_ORIGIN}/ui/sessions/${sessionId}/live`,
      additive: { retained: true },
    })
    expect(rewritten.headers["x-upstream-additive"]).toBe("preserved")
    expect(rewritten.headers["x-managed-worker-id"]).toBeUndefined()
    expect(rewritten.headers["content-length"]).toBe(String(rewritten.body.byteLength))
    expect(rewritten.headers["transfer-encoding"]).toBeUndefined()
    expect(rewritten.body.toString("utf8")).not.toContain("worker-00")
    expect(rewritten.body.toString("utf8")).not.toContain(":3000")
  })

  it("keeps viewer HTML and cast transport distinct", () => {
    // Given
    const sessionId = publicSessionId(2)
    const upstream = response({
      websocketUrl: `${INTERNAL_ORIGIN.replace("http:", "ws:")}/`,
      sessionViewerUrl: `${INTERNAL_ORIGIN}/`,
      sessionViewerFullscreenUrl: `${INTERNAL_ORIGIN}/?showControls=false`,
    })

    // When
    const rewritten = rewritePublicResponse({
      publicOrigin: PUBLIC_ORIGIN,
      requestMethod: PublicHttpMethod.GET,
      routeId: PublicRouteId.SESSIONS_LIVE_DETAILS,
      sessionId,
      upstreamOrigin: INTERNAL_ORIGIN,
      response: upstream,
    })
    const body = JSON.parse(rewritten.body.toString("utf8"))

    // Then
    expect(body.sessionViewerUrl).toBe(`${PUBLIC_ORIGIN}/ui/sessions/${sessionId}/live`)
    expect(body.sessionViewerFullscreenUrl).toBe(
      `${PUBLIC_ORIGIN}/ui/sessions/${sessionId}/live?showControls=false`,
    )
    expect(body.websocketUrl).toBe(
      `${PUBLIC_ORIGIN.replace("https:", "wss:")}/v1/sessions/${sessionId}/cast`,
    )
  })

  it("rewrites the controlled CDP Location without exposing worker authority", () => {
    // Given
    const sessionId = publicSessionId(3)
    const upstream: UpstreamHttpResponse = {
      statusCode: 302,
      headers: {
        location: `${INTERNAL_ORIGIN}/devtools/devtools_app.html?ws=//worker-00:3000/devtools/page/page-a`,
      },
      body: Buffer.alloc(0),
    }

    // When
    const rewritten = rewritePublicResponse({
      publicOrigin: PUBLIC_ORIGIN,
      requestMethod: PublicHttpMethod.GET,
      routeId: PublicRouteId.CDP_DEVTOOLS,
      sessionId,
      upstreamOrigin: INTERNAL_ORIGIN,
      response: upstream,
    })

    // Then
    const location = String(rewritten.headers["location"])
    expect(location).toContain("candidate.steel.example")
    expect(location).toContain(encodeURIComponent(`?sessionId=${sessionId}`))
    expect(location).not.toContain("worker-00")
    expect(location).not.toContain(":3000")
  })

  it("rewrites typed documentation JSON and debug HTML public URL fields", () => {
    // Given
    const sessionId = publicSessionId(4)
    const documentation = response({
      openapi: "3.1.0",
      servers: [{ url: `${INTERNAL_ORIGIN}/` }],
    })
    const debugHtml: UpstreamHttpResponse = {
      statusCode: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: Buffer.from(`<script>const wsUrl="ws://worker-00:3000/v1/sessions/cast"</script>`),
    }

    // When
    const rewrittenDocumentation = rewritePublicResponse({
      publicOrigin: PUBLIC_ORIGIN,
      requestMethod: PublicHttpMethod.GET,
      routeId: PublicRouteId.DOCS_OPENAPI_JSON,
      upstreamOrigin: INTERNAL_ORIGIN,
      response: documentation,
    })
    const rewrittenDebug = rewritePublicResponse({
      publicOrigin: PUBLIC_ORIGIN,
      requestMethod: PublicHttpMethod.GET,
      routeId: PublicRouteId.SESSIONS_DEBUG,
      sessionId,
      upstreamOrigin: INTERNAL_ORIGIN,
      response: debugHtml,
    })

    // Then
    expect(JSON.parse(rewrittenDocumentation.body.toString("utf8"))).toMatchObject({
      servers: [{ url: `${PUBLIC_ORIGIN}/` }],
    })
    expect(rewrittenDebug.body.toString("utf8")).toContain(
      `wss://candidate.steel.example/v1/sessions/${sessionId}/cast`,
    )
    expect(rewrittenDebug.body.toString("utf8")).not.toContain("worker-00")
  })

  it.each([400, 503])("preserves a valid upstream HTTP %i error without route parsing", (statusCode) => {
    // Given
    const body = Buffer.from(JSON.stringify({ additive: true, statusCode }))
    const upstream: UpstreamHttpResponse = {
      statusCode,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "retry-after": "7",
        "transfer-encoding": "chunked",
      },
      body,
    }

    // When
    const rewritten = rewritePublicResponse({
      publicOrigin: PUBLIC_ORIGIN,
      requestMethod: PublicHttpMethod.GET,
      routeId: PublicRouteId.SESSIONS_LIST,
      upstreamOrigin: INTERNAL_ORIGIN,
      response: upstream,
    })

    // Then
    expect(rewritten.statusCode).toBe(statusCode)
    expect(rewritten.body).toEqual(body)
    expect(rewritten.headers["retry-after"]).toBe("7")
    expect(rewritten.headers["content-length"]).toBe(String(body.byteLength))
    expect(rewritten.headers["transfer-encoding"]).toBeUndefined()
  })

  it("preserves an empty implicit HEAD body without attempting JSON parsing", () => {
    // Given
    const upstream: UpstreamHttpResponse = {
      statusCode: 200,
      headers: {
        "content-length": "1234",
        "content-type": "application/json; charset=utf-8",
      },
      body: Buffer.alloc(0),
    }

    // When
    const rewritten = rewritePublicResponse({
      publicOrigin: PUBLIC_ORIGIN,
      requestMethod: PublicHttpMethod.HEAD,
      routeId: PublicRouteId.SESSIONS_LIST,
      upstreamOrigin: INTERNAL_ORIGIN,
      response: upstream,
    })

    // Then
    expect(rewritten.body).toEqual(Buffer.alloc(0))
    expect(rewritten.headers["content-length"]).toBe("1234")
  })

  it("preserves an empty 304 response without inventing a body length", () => {
    // Given
    const upstream: UpstreamHttpResponse = {
      statusCode: 304,
      headers: {
        "content-length": "88",
        "content-type": "application/json; charset=utf-8",
        etag: '"v1"',
      },
      body: Buffer.alloc(0),
    }

    // When
    const rewritten = rewritePublicResponse({
      publicOrigin: PUBLIC_ORIGIN,
      requestMethod: PublicHttpMethod.GET,
      routeId: PublicRouteId.SESSIONS_LIST,
      upstreamOrigin: INTERNAL_ORIGIN,
      response: upstream,
    })

    // Then
    expect(rewritten.statusCode).toBe(304)
    expect(rewritten.body).toEqual(Buffer.alloc(0))
    expect(rewritten.headers["content-length"]).toBe("88")
    expect(rewritten.headers["etag"]).toBe('"v1"')
  })

  it("preserves successful JSON bytes when the route has no typed URL fields", () => {
    // Given
    const body = Buffer.from('{ "status" : "ok", "large" : 9007199254740993 }\n')
    const upstream: UpstreamHttpResponse = {
      statusCode: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body,
    }

    // When
    const rewritten = rewritePublicResponse({
      publicOrigin: PUBLIC_ORIGIN,
      requestMethod: PublicHttpMethod.GET,
      routeId: PublicRouteId.HEALTH,
      upstreamOrigin: INTERNAL_ORIGIN,
      response: upstream,
    })

    // Then
    expect(rewritten.body.equals(body)).toBe(true)
  })

  it("rejects mixed-case private authorities in successful headers", () => {
    // Given
    const upstream: UpstreamHttpResponse = {
      statusCode: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-worker-location": "HTTP://WORKER-00:3000/private",
      },
      body: Buffer.from('{"status":"ok"}'),
    }

    // When / Then
    expect(() => rewritePublicResponse({
      publicOrigin: PUBLIC_ORIGIN,
      requestMethod: PublicHttpMethod.GET,
      routeId: PublicRouteId.HEALTH,
      upstreamOrigin: INTERNAL_ORIGIN,
      response: upstream,
    })).toThrow("upstream response header contained a private origin")
  })

  it("preserves opaque binary bytes that happen to contain a private authority", () => {
    // Given
    const body = Buffer.concat([
      Buffer.from([0x00, 0xff, 0x89, 0x50, 0x4e, 0x47]),
      Buffer.from("worker-00:3000"),
      Buffer.from([0x00, 0x01]),
    ])
    const upstream: UpstreamHttpResponse = {
      statusCode: 200,
      headers: { "content-type": "application/octet-stream" },
      body,
    }

    // When
    const rewritten = rewritePublicResponse({
      publicOrigin: PUBLIC_ORIGIN,
      requestMethod: PublicHttpMethod.GET,
      routeId: PublicRouteId.FILES_DOWNLOAD,
      upstreamOrigin: INTERNAL_ORIGIN,
      response: upstream,
    })

    // Then
    expect(rewritten.body.equals(body)).toBe(true)
    expect(rewritten.headers["content-length"]).toBe(String(body.byteLength))
  })
})
