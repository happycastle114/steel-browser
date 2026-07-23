import ky from "ky"
import { describe, expect, it, vi } from "vitest"

import { ApiFailureKind, MutationCertainty, createManagedApi } from "../src/api/client.js"
import { CONTROL_PLANE_API_VERSION, SessionIdSchema } from "../src/api/schema-primitives.js"
import { ActionKind } from "../src/domain/vocabulary.js"

const versionFixture = {
  apiVersion: CONTROL_PLANE_API_VERSION,
  browserVersion: "125.0.6422.60",
  createTokenKeyId: "0123456789abcdef",
  managedSha: "a".repeat(40),
  managerConfigSha256: "f".repeat(64),
  managerDigest: `sha256:${"b".repeat(64)}`,
  releaseEvidenceMode: "CONFIG_FILE",
  releaseEvidenceSha256: "0".repeat(64),
  startedAt: "2026-07-21T04:00:00.000Z",
  toolchainLockSha256: "c".repeat(64),
  upstreamSha: "d".repeat(40),
  workerDigest: `sha256:${"e".repeat(64)}`,
} as const

describe("createManagedApi", () => {
  it("requests managed resources from the same origin and parses the response", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(versionFixture), {
      headers: { "content-type": "application/json" },
      status: 200,
    }))
    const api = createManagedApi(ky.create({ fetch: mockFetch, retry: 0 }))

    const version = await api.version()

    const request = mockFetch.mock.calls[0]?.[0]
    expect(request).toBeInstanceOf(Request)
    expect(request instanceof Request ? new URL(request.url).pathname : "").toBe("/v1/managed/version")
    expect(version.browserVersion).toBe(versionFixture.browserVersion)
  })

  it("classifies an Access denial instead of returning an empty resource", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response("forbidden", { status: 403 }))
    const api = createManagedApi(ky.create({ fetch: mockFetch, retry: 0 }))

    await expect(api.version()).rejects.toMatchObject({ kind: ApiFailureKind.FORBIDDEN, status: 403 })
  })

  it("wraps browser actions in the canonical AI action envelope with explicit session affinity", async () => {
    const sessionId = SessionIdSchema.parse("550e8400-e29b-41d4-a716-446655440000")
    const resultFixture = {
      actionId: "550e8400-e29b-41d4-a716-446655440001",
      completedAt: "2026-07-21T04:00:01.000Z",
      kind: "action",
      sessionId,
    }
    let body: unknown
    const mockFetch = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      body = input instanceof Request ? await input.clone().json() : undefined
      return new Response(JSON.stringify(resultFixture), {
        headers: { "content-type": "application/json" },
        status: 200,
      })
    })
    const api = createManagedApi(ky.create({ fetch: mockFetch, retry: 0 }))

    await api.action({ kind: ActionKind.CLICK, selector: "#submit", sessionId })

    expect(body).toEqual({
      apiVersion: CONTROL_PLANE_API_VERSION,
      arguments: { selector: "#submit", sessionId },
      tool: { name: ActionKind.CLICK, version: "1.0.0" },
    })
  })

  it("creates a managed admission with a generated idempotency key and closed operation", async () => {
    const admissionFixture = {
      admission: {
        admissionId: "550e8400-e29b-41d4-a716-446655440010",
        createdAt: "2026-07-21T04:00:00.000Z",
        expiresAt: "2026-07-21T04:05:00.000Z",
        position: 1,
        state: "QUEUED",
        updatedAt: "2026-07-21T04:00:00.000Z",
      },
      kind: "admission",
    }
    let body: unknown
    const mockFetch = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      body = input instanceof Request ? await input.clone().json() : undefined
      return new Response(JSON.stringify(admissionFixture), { headers: { "content-type": "application/json" }, status: 202 })
    })
    const api = createManagedApi(ky.create({ fetch: mockFetch, retry: 0 }))

    await api.createSession("console:550e8400-e29b-41d4-a716-446655440099")

    const request = mockFetch.mock.calls[0]?.[0]
    expect(request instanceof Request ? new URL(request.url).pathname : "").toBe("/v1/managed/admissions")
    expect(body).toEqual({ idempotencyKey: "console:550e8400-e29b-41d4-a716-446655440099", operation: "SESSION_CREATE" })
  })

  it("rejects a live-view result that is not bound to the requested public session", async () => {
    const sessionId = SessionIdSchema.parse("550e8400-e29b-41d4-a716-446655440000")
    const mismatched = {
      castWebSocketUrl: "ws://localhost/v1/sessions/550e8400-e29b-41d4-a716-446655440099/cast",
      kind: "live_view",
      sessionId,
      viewerUrl: "http://localhost/ui/sessions/550e8400-e29b-41d4-a716-446655440099/live",
    }
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(mismatched), { headers: { "content-type": "application/json" }, status: 200 }))
    const api = createManagedApi(ky.create({ fetch: mockFetch, retry: 0 }))

    await expect(api.liveView(sessionId)).rejects.toMatchObject({ kind: ApiFailureKind.PROTOCOL })
  })

  it("fails closed when a session resource returns a different identity", async () => {
    const requested = SessionIdSchema.parse("550e8400-e29b-41d4-a716-446655440000")
    const response = { createdAt: "2026-07-21T04:00:00.000Z", sessionId: "550e8400-e29b-41d4-a716-446655440099", state: "LIVE" }
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(response), { headers: { "content-type": "application/json" }, status: 200 }))
    const api = createManagedApi(ky.create({ fetch: mockFetch, retry: 0 }))

    await expect(api.session(requested)).rejects.toMatchObject({ kind: ApiFailureKind.PROTOCOL, mutationCertainty: MutationCertainty.INDETERMINATE })
  })

  it("marks transport loss as an unknown mutation outcome and a 4xx response as rejected", async () => {
    const lostFetch = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("response lost"))
    const rejectedFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response("conflict", { status: 409 }))
    const lost = createManagedApi(ky.create({ fetch: lostFetch, retry: 0 }))
    const rejected = createManagedApi(ky.create({ fetch: rejectedFetch, retry: 0 }))

    await expect(lost.createSession("console:550e8400-e29b-41d4-a716-446655440099")).rejects.toMatchObject({ mutationCertainty: MutationCertainty.INDETERMINATE })
    await expect(rejected.createSession("console:550e8400-e29b-41d4-a716-446655440099")).rejects.toMatchObject({ mutationCertainty: MutationCertainty.REJECTED })
  })
})
