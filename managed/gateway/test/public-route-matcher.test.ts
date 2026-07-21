import { describe, expect, it } from "vitest"
import {
  PublicHttpMethod,
  PublicRouteId,
} from "../src/api/public/schemas.js"
import {
  PublicRouteMatchKind,
  matchPublicRoute,
} from "../src/api/public/routes.js"

describe("matchPublicRoute", () => {
  it("prefers the exact active-release route over the session-id parameter route", () => {
    // Given / When
    const match = matchPublicRoute(PublicHttpMethod.POST, "/v1/sessions/release")

    // Then
    expect(match).toMatchObject({
      kind: PublicRouteMatchKind.MATCHED,
      route: { id: PublicRouteId.SESSIONS_RELEASE_ACTIVE },
      params: {},
    })
  })

  it("returns the exact Allow methods for a known path with a wrong method", () => {
    // Given / When
    const match = matchPublicRoute(PublicHttpMethod.DELETE, "/v1/sessions")

    // Then
    expect(match).toEqual({
      kind: PublicRouteMatchKind.METHOD_NOT_ALLOWED,
      allow: [PublicHttpMethod.GET, PublicHttpMethod.HEAD, PublicHttpMethod.POST],
    })
  })

  it("does not approve an unknown managed or AI sibling path", () => {
    // Given / When
    const match = matchPublicRoute(PublicHttpMethod.GET, "/v1/managed/ai/sessions")

    // Then
    expect(match).toEqual({ kind: PublicRouteMatchKind.NOT_FOUND })
  })

  it("decodes the session identifier while preserving the file wildcard path", () => {
    // Given / When
    const match = matchPublicRoute(
      PublicHttpMethod.GET,
      "/v1/sessions/00000000-0000-4000-8000-000000001001/files/folder/a%20b.txt",
    )

    // Then
    expect(match).toMatchObject({
      kind: PublicRouteMatchKind.MATCHED,
      route: { id: PublicRouteId.FILES_DOWNLOAD },
      params: {
        sessionId: "00000000-0000-4000-8000-000000001001",
        wildcard: "folder/a b.txt",
      },
    })
  })

  it.each([
    "/selenium/wd/../../v1/sessions",
    "/selenium/wd/%2e%2e/%2e%2e/v1/sessions",
  ])("rejects a non-canonical wildcard path before route selection: %s", (path) => {
    // Given / When
    const match = matchPublicRoute(PublicHttpMethod.POST, path)

    // Then
    expect(match).toEqual({ kind: PublicRouteMatchKind.NOT_FOUND })
  })

  it.each([
    PublicHttpMethod.PUT,
    PublicHttpMethod.PATCH,
  ])("matches concrete Selenium %s requests through the ALL route", (method) => {
    // Given / When
    const match = matchPublicRoute(method, "/selenium/wd/session/managed/element")

    // Then
    expect(match).toMatchObject({
      kind: PublicRouteMatchKind.MATCHED,
      route: { id: PublicRouteId.SELENIUM_PROXY },
    })
  })
})
