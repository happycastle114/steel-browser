import { afterEach, describe, expect, it } from "vitest"
import { PublicHttpMethod } from "../src/index.js"
import {
  PUBLIC_HOST,
  closePublicRestFixtures,
  createPublicRestFixture,
  parsedBody,
  publicRequest,
} from "./public-rest-gateway-fixture.js"

afterEach(closePublicRestFixtures)

describe("PublicRestGateway error integration", () => {
  it("authenticates before revealing an unknown route", async () => {
    // Given
    const { gateway } = await createPublicRestFixture()
    const request = publicRequest(PublicHttpMethod.GET, "/v1/private-unapproved")

    // When
    const response = await gateway.handle({
      ...request,
      headers: { authorization: "Bearer rejected", host: PUBLIC_HOST },
    })

    // Then
    expect(response.statusCode).toBe(401)
    expect(parsedBody(response)).toMatchObject({ error: { code: "ACCESS_AUTH_REQUIRED" } })
  })

  it("returns exact Allow metadata for a known path with the wrong method", async () => {
    // Given
    const { gateway } = await createPublicRestFixture()

    // When
    const response = await gateway.handle(publicRequest(PublicHttpMethod.DELETE, "/v1/health"))

    // Then
    expect(response.statusCode).toBe(405)
    expect(response.headers["allow"]).toBe("GET, HEAD")
    expect(parsedBody(response)).toMatchObject({ error: { code: "METHOD_NOT_ALLOWED" } })
  })

  it("returns the closed unknown-route error after authentication", async () => {
    // Given
    const { gateway } = await createPublicRestFixture()

    // When
    const response = await gateway.handle(publicRequest(PublicHttpMethod.GET, "/v1/private-unapproved"))

    // Then
    expect(response.statusCode).toBe(404)
    expect(parsedBody(response)).toMatchObject({ error: { code: "ROUTE_NOT_FOUND" } })
  })

  it("rejects the declared Cloud-only create field before lifecycle execution", async () => {
    // Given
    const { gateway, lifecycle } = await createPublicRestFixture()

    // When
    const response = await gateway.handle(publicRequest(
      PublicHttpMethod.POST,
      "/v1/sessions",
      Buffer.from(JSON.stringify({ solveCaptcha: false })),
    ))

    // Then
    expect(response.statusCode).toBe(422)
    expect(parsedBody(response)).toMatchObject({
      error: {
        code: "MANAGED_FEATURE_UNSUPPORTED",
        details: { capabilityUrl: "/v1/capabilities", feature: "solveCaptcha" },
      },
    })
    expect(lifecycle.createCalls).toBe(0)
  })

  it("bounds lifecycle request bodies before any worker mutation", async () => {
    // Given
    const { gateway, lifecycle, workers } = await createPublicRestFixture()

    // When
    const response = await gateway.handle(publicRequest(
      PublicHttpMethod.POST,
      "/v1/sessions",
      Buffer.alloc(1025),
    ))

    // Then
    expect(response.statusCode).toBe(413)
    expect(parsedBody(response)).toMatchObject({ error: { code: "BODY_TOO_LARGE" } })
    expect(lifecycle.createCalls).toBe(0)
    expect(workers.flatMap(({ requests }) => requests)).toEqual([])
  })

  it("rejects encoded Selenium traversal before worker selection", async () => {
    // Given
    const { gateway, workers } = await createPublicRestFixture()

    // When
    const response = await gateway.handle(publicRequest(
      PublicHttpMethod.POST,
      "/selenium/wd/%252e%252e/%252e%252e/v1/sessions",
      Buffer.from("{}"),
    ))

    // Then
    expect(response.statusCode).toBe(404)
    expect(workers.flatMap(({ requests }) => requests)).toEqual([])
  })

  it("preserves a valid upstream 503 through affinity and rewriting", async () => {
    // Given
    const { gateway, workers } = await createPublicRestFixture()
    const created = parsedBody(await gateway.handle(
      publicRequest(PublicHttpMethod.POST, "/v1/sessions", Buffer.from("{}")),
    ))
    if (!hasSessionId(created)) throw new TypeError("expected a session ID")
    const path = `/v1/sessions/${created.id}/context`
    workers[0].respondWith(path, 503)

    // When
    const response = await gateway.handle(publicRequest(PublicHttpMethod.GET, path))

    // Then
    expect(response.statusCode).toBe(503)
    expect(parsedBody(response)).toEqual({ additive: "worker-0", statusCode: 503 })
  })

  it("preserves a file HEAD representation length with an empty body", async () => {
    // Given
    const { gateway } = await createPublicRestFixture()
    const created = parsedBody(await gateway.handle(
      publicRequest(PublicHttpMethod.POST, "/v1/sessions", Buffer.from("{}")),
    ))
    if (!hasSessionId(created)) throw new TypeError("expected a session ID")

    // When
    const response = await gateway.handle(publicRequest(
      PublicHttpMethod.HEAD,
      `/v1/sessions/${created.id}/files/report.txt`,
    ))

    // Then
    if ("streaming" in response) throw new TypeError("expected a buffered HEAD response")
    expect(response.statusCode).toBe(200)
    expect(response.body.byteLength).toBe(0)
    expect(response.headers["content-length"]).toBe("1234")
  })
})

function hasSessionId(value: unknown): value is { readonly id: string } {
  return typeof value === "object" && value !== null && "id" in value && typeof value.id === "string"
}
