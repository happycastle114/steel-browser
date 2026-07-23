import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  PROTOCOL_KIND,
  RouteMatrixSchema,
} from "@happycastle/steel-managed-shared"
import { describe, expect, it } from "vitest"
import {
  PUBLIC_REST_ROUTES,
  PublicRouteMatchKind,
  matchPublicRoute,
} from "../src/api/public/routes.js"
import { PublicHttpMethodSchema } from "../src/api/public/schemas.js"

const REST_BEHAVIOR_CASES = [
  ["POST", "/v1/scrape", "rest.action.scrape"],
  ["POST", "/v1/screenshot", "rest.action.screenshot"],
  ["POST", "/v1/pdf", "rest.action.pdf"],
  ["POST", "/v1/search", "rest.action.search"],
  ["GET", "/v1/devtools/inspector.html", "rest.cdp.devtools"],
  ["POST", "/v1/sessions/00000000-0000-4000-8000-000000001001/files", "rest.files.upload"],
  ["HEAD", "/v1/sessions/00000000-0000-4000-8000-000000001001/files/report.txt", "rest.files.head"],
  ["GET", "/v1/sessions/00000000-0000-4000-8000-000000001001/files/report.txt", "rest.files.download"],
  ["GET", "/v1/sessions/00000000-0000-4000-8000-000000001001/files", "rest.files.list"],
  ["DELETE", "/v1/sessions/00000000-0000-4000-8000-000000001001/files/report.txt", "rest.files.delete"],
  ["DELETE", "/v1/sessions/00000000-0000-4000-8000-000000001001/files", "rest.files.delete-all"],
  ["GET", "/v1/sessions/00000000-0000-4000-8000-000000001001/files.zip", "rest.files.archive"],
  ["GET", "/v1/logs/query", "rest.logs.query"],
  ["GET", "/v1/logs/stats", "rest.logs.stats"],
  ["GET", "/v1/logs/stream", "rest.logs.stream"],
  ["POST", "/v1/logs/export", "rest.logs.export"],
  ["DELETE", "/v1/logs/", "rest.logs.clear"],
  ["PUT", "/selenium/wd/session/one/url", "rest.selenium.proxy"],
  ["PATCH", "/selenium/wd/session/one/url", "rest.selenium.proxy"],
  ["GET", "/v1/health", "rest.health"],
  ["POST", "/v1/sessions", "rest.sessions.create"],
  ["GET", "/v1/sessions", "rest.sessions.list"],
  ["GET", "/v1/sessions/00000000-0000-4000-8000-000000001001", "rest.sessions.get"],
  ["GET", "/v1/sessions/00000000-0000-4000-8000-000000001001/context", "rest.sessions.context"],
  ["POST", "/v1/sessions/00000000-0000-4000-8000-000000001001/release", "rest.sessions.release-id"],
  ["POST", "/v1/sessions/release", "rest.sessions.release-active"],
  ["GET", "/v1/sessions/debug", "rest.sessions.debug"],
  ["POST", "/v1/events", "rest.sessions.events"],
  ["GET", "/v1/sessions/00000000-0000-4000-8000-000000001001/live-details", "rest.sessions.live-details"],
  ["POST", "/v1/sessions/scrape", "rest.sessions.scrape"],
  ["POST", "/v1/sessions/screenshot", "rest.sessions.screenshot"],
  ["POST", "/v1/sessions/pdf", "rest.sessions.pdf"],
  ["GET", "/documentation", "rest.docs.redirect"],
  ["GET", "/documentation/", "rest.docs.html"],
  ["GET", "/documentation/openapi.json", "rest.docs.openapi-json"],
  ["GET", "/documentation/openapi.yaml", "rest.docs.openapi-yaml"],
  ["GET", "/documentation/js/scalar.js", "rest.docs.scalar-js"],
  ["OPTIONS", "/v1/anything", "rest.cors.options"],
] as const

describe("public REST route catalog", () => {
  it("equals every runtime-relevant field in the pinned Task 3 REST allowlist", () => {
    // Given
    const matrixPath = fileURLToPath(
      new URL(
        "../../tests/upstream/5880b48c1af107219ff3d904edbb8f6b76bea9b6/route-matrix.json",
        import.meta.url,
      ),
    )
    const matrix = RouteMatrixSchema.parse(JSON.parse(readFileSync(matrixPath, "utf8")))
    const expected = matrix.routes
      .filter((route) => route.protocol === PROTOCOL_KIND.REST)
      .map(({ affinity, id, implicitHead, lifecycle, method, path }) => ({
        affinity,
        id,
        implicitHead,
        lifecycle,
        method,
        path,
      }))
      .sort((left, right) => left.id.localeCompare(right.id))

    // When
    const actual = PUBLIC_REST_ROUTES.map(
      ({ affinity, id, implicitHead, lifecycle, method, path }) => ({
        affinity,
        id,
        implicitHead,
        lifecycle,
        method,
        path,
      }),
    ).sort((left, right) => left.id.localeCompare(right.id))

    // Then
    expect(actual).toEqual(expected)
  })

  it.each(REST_BEHAVIOR_CASES)("routes %s %s to %s", (method, pathAndQuery, routeId) => {
    // Given / When
    const match = matchPublicRoute(PublicHttpMethodSchema.parse(method), pathAndQuery)

    // Then
    expect(match.kind).toBe(PublicRouteMatchKind.MATCHED)
    if (match.kind !== PublicRouteMatchKind.MATCHED) throw new TypeError("expected a route match")
    expect(match.route.id).toBe(routeId)
  })
})
