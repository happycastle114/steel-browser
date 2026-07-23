import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"
import { AccessJwtAuthenticator } from "../src/auth/jwt-authenticator.js"
import { JwksKeyStore } from "../src/auth/jwks-key-store.js"
import { buildPublicServer } from "../src/http/public-server.js"
import { AuthorizedRequestContextStore } from "../src/http/request-context-store.js"
import { RequestSecurity } from "../src/http/request-security.js"
import { parseManagerConfig } from "../src/config.js"
import {
  AtomicReservationLedger,
  ReservationLedgerKind,
} from "../src/memory/atomic-reservation-ledger.js"
import { validManagerConfigInput, validPoolId } from "./fixtures.js"
import { signingFixture, signedJwt, type SigningFixture } from "./jwt-fixture.js"
import { MutableClock } from "./test-clock.js"
import { writeUiAssetManifest } from "../src/ui/asset-manifest.js"

describe("Fastify security and catch-all ordering", () => {
  let app: FastifyInstance
  let key: SigningFixture
  let token: string
  let uiRoot: string
  let compatibilityHealthReads: number

  beforeEach(async () => {
    const clock = new MutableClock(1_800_000_000_000)
    key = signingFixture("fastify-security")
    token = signedJwt({ kid: key.jwk.kid, privateKey: key.privateKey })
    const authenticator = new AccessJwtAuthenticator({
      audiences: ["steel-audience"],
      clock,
      issuer: "https://team.cloudflareaccess.com",
      keyStore: new JwksKeyStore({ clock, fetcher: { fetch: async () => [key.jwk] } }),
      maxTokenTtlSeconds: 86_400,
      operatorServicePrincipals: ["operator-service"],
      skewSeconds: 60,
    })
    const config = parseManagerConfig(validManagerConfigInput(), validPoolId())
    const connectionLedger = new AtomicReservationLedger({
      kind: ReservationLedgerKind.INGRESS_CONNECTION,
      limitBytes: config.controlPlane.memory.ingressConnectionBudgetBytes,
      limitCount: config.controlPlane.memory.ingressConnectionMax,
    })
    const bodyLedger = new AtomicReservationLedger({
      kind: ReservationLedgerKind.INGRESS_BODY,
      limitBytes: config.controlPlane.memory.ingressBodyBudgetBytes,
      limitCount: config.controlPlane.memory.ingressBodyMax,
    })
    uiRoot = await mkdtemp(path.join(tmpdir(), "steel-manager-public-ui-"))
    await writeFile(path.join(uiRoot, "index.html"), "<!doctype html><main>Steel</main>", "utf8")
    const uiManifest = await writeUiAssetManifest(uiRoot)
    compatibilityHealthReads = 0
    app = buildPublicServer({
      bodyLedger,
      compatibilityHealth: {
        read: async () => {
          compatibilityHealthReads += 1
          return { status: "ok" }
        },
      },
      config,
      connectionLedger,
      onConnectionRejected: () => undefined,
      requestContexts: new AuthorizedRequestContextStore(),
      requestSecurity: new RequestSecurity({
        authenticate: (headers) => authenticator.authenticate(headers),
        originByHost: config.controlPlane.publicOriginByHost,
      }),
      uiAssets: { manifest: uiManifest, root: uiRoot },
    })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    await rm(uiRoot, { force: true, recursive: true })
  })

  it("runs Host rejection before unknown-route disclosure", async () => {
    // Given: an unauthenticated request to a route that does not exist.
    const headers = { host: "unknown.example.com" }

    // When: Fastify resolves the request.
    const response = await app.inject({ headers, method: "GET", url: "/does-not-exist" })

    // Then: invalid Host is disclosed instead of route existence.
    expect(response.statusCode).toBe(421)
  })

  it("runs authentication before unknown-route disclosure", async () => {
    // Given: an allowed Host without an Access assertion.
    const headers = { host: "steel.example.com" }

    // When: the request targets an unknown route.
    const response = await app.inject({ headers, method: "GET", url: "/does-not-exist" })

    // Then: authentication fails before the final 404 handler.
    expect(response.statusCode).toBe(401)
  })

  it("returns 404 only after Host and authentication succeed", async () => {
    // Given: an allowed Host and valid Access assertion.
    const headers = { "cf-access-jwt-assertion": token, host: "steel.example.com" }

    // When: the authenticated request targets an unknown route.
    const response = await app.inject({ headers, method: "GET", url: "/does-not-exist" })

    // Then: the final route result is 404.
    expect(response.statusCode).toBe(404)
  })

  it("does not expose public liveness or readiness routes", async () => {
    // Given: authenticated requests for the internal-only health paths.
    const headers = { "cf-access-jwt-assertion": token, host: "steel.example.com" }

    // When: both paths are requested through the public server.
    const responses = await Promise.all([
      app.inject({ headers, method: "GET", url: "/livez" }),
      app.inject({ headers, method: "GET", url: "/readyz" }),
    ])

    // Then: neither path exists publicly.
    expect(responses.map((response) => response.statusCode)).toEqual([404, 404])
  })

  it("authenticates public compatibility health and emits the exact CORS header set", async () => {
    // Given: a valid authenticated preflight from the Host-selected Origin.
    const headers = {
      "cf-access-jwt-assertion": token,
      host: "steel.example.com",
      origin: "https://steel.example.com",
    }

    // When: compatibility health and preflight are requested.
    const health = await app.inject({ headers, method: "GET", url: "/v1/health" })
    const preflight = await app.inject({ headers, method: "OPTIONS", url: "/mcp" })

    // Then: health stays compatible and CORS includes content negotiation and MCP revision headers.
    expect(health.statusCode).toBe(200)
    expect(health.json()).toEqual({ status: "ok" })
    expect(compatibilityHealthReads).toBe(1)
    expect(preflight.statusCode).toBe(204)
    const allowedHeaders = preflight.headers["access-control-allow-headers"]
      ?.toLowerCase()
      .split(",")
      .map((value) => value.trim())
    expect(allowedHeaders).toEqual(
      expect.arrayContaining(["accept", "mcp-protocol-version", "cf-access-jwt-assertion"]),
    )
  })

  it("serves the verified console only after Host and Access authentication", async () => {
    const authenticated = await app.inject({
      headers: { "cf-access-jwt-assertion": token, host: "steel.example.com" },
      method: "GET",
      url: "/ui/",
    })
    const unauthenticated = await app.inject({
      headers: { host: "steel.example.com" },
      method: "GET",
      url: "/ui/",
    })

    expect(authenticated.statusCode).toBe(200)
    expect(authenticated.body).toContain("<main>Steel</main>")
    expect(unauthenticated.statusCode).toBe(401)
  })
})
