import { afterEach, describe, expect, it } from "vitest"
import {
  PublicHttpMethod,
  PublicSessionIdSchema,
  SessionState,
  type PublicSessionId,
} from "../src/index.js"
import { publicSessionId } from "./test-support.js"
import {
  PUBLIC_ORIGIN,
  closePublicRestFixtures,
  createPublicRestFixture,
  parsedBody,
  publicRequest,
} from "./public-rest-gateway-fixture.js"

afterEach(closePublicRestFixtures)

describe("PublicRestGateway integration", () => {
  it("preserves and rewrites the raw lifecycle create response", async () => {
    // Given
    const { gateway, lifecycle } = await createPublicRestFixture()

    // When
    const response = await gateway.handle(publicRequest(
      PublicHttpMethod.POST,
      "/v1/sessions",
      Buffer.from(JSON.stringify({ additiveInput: true })),
    ))
    const body = parsedBody(response)

    // Then
    expect(response.statusCode).toBe(200)
    expect(body).toMatchObject({ additive: "worker-0", status: "live" })
    expect(body).toMatchObject({
      websocketUrl: expect.stringContaining(`${PUBLIC_ORIGIN.replace("https:", "wss:")}/`),
      debugUrl: expect.stringContaining(`${PUBLIC_ORIGIN}/v1/sessions/debug`),
      sessionViewerUrl: expect.stringContaining(`${PUBLIC_ORIGIN}/ui/sessions/`),
    })
    expect(response.body.toString("utf8")).not.toContain("127.0.0.1")
    expect(lifecycle.createCalls).toBe(1)
  })

  it("aggregates two worker session lists in deterministic public-ID order", async () => {
    // Given
    const { gateway } = await createPublicRestFixture()
    await gateway.handle(publicRequest(PublicHttpMethod.POST, "/v1/sessions", Buffer.from("{}")))
    await gateway.handle(publicRequest(PublicHttpMethod.POST, "/v1/sessions", Buffer.from("{}")))

    // When
    const response = await gateway.handle(publicRequest(PublicHttpMethod.GET, "/v1/sessions"))
    const body = parsedBody(response)

    // Then
    expect(body).toMatchObject({ additive: "worker-0" })
    expect(body).toMatchObject({ sessions: [
      { additive: "worker-0", id: "00000000-0000-4000-8000-000000001001" },
      { additive: "worker-1", id: "00000000-0000-4000-8000-000000001002" },
    ] })
    expect(response.body.toString("utf8")).not.toContain("127.0.0.1")
  })

  it("uses explicit affinity to keep simultaneous session calls on their workers", async () => {
    // Given
    const { gateway } = await createPublicRestFixture()
    const first = parsedBody(await gateway.handle(
      publicRequest(PublicHttpMethod.POST, "/v1/sessions", Buffer.from("{}")),
    ))
    const second = parsedBody(await gateway.handle(
      publicRequest(PublicHttpMethod.POST, "/v1/sessions", Buffer.from("{}")),
    ))
    if (!hasSessionId(first) || !hasSessionId(second)) throw new TypeError("expected session IDs")

    // When
    const [firstContext, secondContext] = await Promise.all([
      gateway.handle(publicRequest(PublicHttpMethod.GET, `/v1/sessions/${first.id}/context`)),
      gateway.handle(publicRequest(PublicHttpMethod.GET, `/v1/sessions/${second.id}/context`)),
    ])

    // Then
    expect(parsedBody(firstContext)).toEqual({ worker: 0 })
    expect(parsedBody(secondContext)).toEqual({ worker: 1 })
  })

  it("releases only the path-affined session through the lifecycle boundary", async () => {
    // Given
    const { gateway, lifecycle, registry } = await createPublicRestFixture()
    const created = parsedBody(await gateway.handle(
      publicRequest(PublicHttpMethod.POST, "/v1/sessions", Buffer.from("{}")),
    ))
    if (!hasSessionId(created)) throw new TypeError("expected a session ID")

    // When
    const response = await gateway.handle(publicRequest(
      PublicHttpMethod.POST,
      `/v1/sessions/${created.id}/release`,
    ))

    // Then
    expect(parsedBody(response)).toMatchObject({ additive: "worker-0", status: SessionState.RELEASED })
    expect(registry.session(created.id)?.state).toBe(SessionState.RELEASED)
    expect(lifecycle.releaseCalls).toBe(1)
  })

  it("fails closed when a worker exposes an unowned stale session", async () => {
    // Given
    const { gateway, workers } = await createPublicRestFixture()
    workers[1].setSessions([publicSessionId(99)])

    // When
    const response = await gateway.handle(publicRequest(PublicHttpMethod.GET, "/v1/sessions"))

    // Then
    expect(response.statusCode).toBe(502)
    expect(parsedBody(response)).toMatchObject({ error: { code: "UPSTREAM_BAD_RESPONSE" } })
  })

  it("fails closed when a worker exposes another worker's live session", async () => {
    // Given
    const { gateway, workers } = await createPublicRestFixture()
    await gateway.handle(publicRequest(PublicHttpMethod.POST, "/v1/sessions", Buffer.from("{}")))
    await gateway.handle(publicRequest(PublicHttpMethod.POST, "/v1/sessions", Buffer.from("{}")))
    workers[1].setSessions([publicSessionId(1)])

    // When
    const response = await gateway.handle(publicRequest(PublicHttpMethod.GET, "/v1/sessions"))

    // Then
    expect(response.statusCode).toBe(502)
    expect(parsedBody(response)).toMatchObject({ error: { code: "UPSTREAM_BAD_RESPONSE" } })
  })

  it("fails closed when a worker duplicates its owned live session", async () => {
    // Given
    const { gateway, workers } = await createPublicRestFixture()
    await gateway.handle(publicRequest(PublicHttpMethod.POST, "/v1/sessions", Buffer.from("{}")))
    workers[0].setSessions([publicSessionId(1), publicSessionId(1)])

    // When
    const response = await gateway.handle(publicRequest(PublicHttpMethod.GET, "/v1/sessions"))

    // Then
    expect(response.statusCode).toBe(502)
    expect(parsedBody(response)).toMatchObject({ error: { code: "UPSTREAM_BAD_RESPONSE" } })
  })

  it("fails closed when an idle worker exposes a released session", async () => {
    // Given
    const { gateway, workers } = await createPublicRestFixture()
    await gateway.handle(publicRequest(PublicHttpMethod.POST, "/v1/sessions", Buffer.from("{}")))
    await gateway.handle(publicRequest(
      PublicHttpMethod.POST,
      `/v1/sessions/${publicSessionId(1)}/release`,
    ))
    workers[0].setSessions([publicSessionId(1)])

    // When
    const response = await gateway.handle(publicRequest(PublicHttpMethod.GET, "/v1/sessions"))

    // Then
    expect(response.statusCode).toBe(502)
    expect(parsedBody(response)).toMatchObject({ error: { code: "UPSTREAM_BAD_RESPONSE" } })
  })

  it("omits or matches aggregate representation length for two-worker HEAD", async () => {
    // Given
    const { gateway } = await createPublicRestFixture()
    await gateway.handle(publicRequest(PublicHttpMethod.POST, "/v1/sessions", Buffer.from("{}")))
    await gateway.handle(publicRequest(PublicHttpMethod.POST, "/v1/sessions", Buffer.from("{}")))
    const get = await gateway.handle(publicRequest(PublicHttpMethod.GET, "/v1/sessions"))

    // When
    const head = await gateway.handle(publicRequest(PublicHttpMethod.HEAD, "/v1/sessions"))

    // Then
    expect([
      undefined,
      get.headers["content-length"],
    ]).toContain(head.headers["content-length"])
  })

  it("streams the first public SSE event and cancels the worker stream", async () => {
    // Given
    const { gateway } = await createPublicRestFixture()
    await gateway.handle(publicRequest(PublicHttpMethod.POST, "/v1/sessions", Buffer.from("{}")))

    // When
    const response = await gateway.handle(publicRequest(PublicHttpMethod.GET, "/v1/logs/stream"))
    if (!("streaming" in response)) throw new TypeError("expected a streaming response")
    const first = await response.body[Symbol.asyncIterator]().next()

    // Then
    expect(first.value?.toString("utf8")).toBe(": connected\n\n")
    expect(response.headers["content-type"]).toContain("text/event-stream")
    expect(response.headers["content-length"]).toBeUndefined()
    expect(response.headers["set-cookie"]).toBeUndefined()
    expect(response.headers["www-authenticate"]).toBeUndefined()
    expect(response.headers["x-managed-private"]).toBeUndefined()
    expect(response.headers["x-worker-location"]).toBeUndefined()
    response.cancel()
    await response.closed
  })
})

function hasSessionId(value: unknown): value is { readonly id: PublicSessionId } {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    PublicSessionIdSchema.safeParse(value.id).success
  )
}
