import { request } from "node:http"
import type { SteelBrowserConfig } from "@steel-browser/api/plugin"
import type { FastifyPluginAsync } from "fastify"
import fastifyPlugin from "fastify-plugin"
import { describe, expect, it } from "vitest"
import {
  UPSTREAM_SESSION_STATUS,
  WORKER_ACTIVE_SESSION_MAX_RESPONSE_BYTES,
  WORKER_ACTIVE_SESSION_PATH,
  WORKER_BOOT_STATUS,
  WORKER_META_PATH,
  parseWorkerConfig,
} from "../src/config.js"
import {
  createWorkerApplication,
  type UpstreamActiveSession,
} from "../src/server.js"
import { deferred } from "./test-support.js"

const INSTANCE_ID = "11223344-5566-4788-99aa-bbccddeeff00"
const SESSION_ID = "99887766-5544-4322-88aa-bbccddeeff00"
const REQUEST_ORIGIN = "https://manager.internal.example"

type HttpResult = {
  readonly body: string
  readonly headers: Readonly<Record<string, string | string[] | undefined>>
  readonly statusCode: number | undefined
}

function requestOrigin(origin: string, path: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const outgoing = request(new URL(path, origin), (response) => {
      const chunks: Buffer[] = []
      response.on("data", (chunk: Buffer) => chunks.push(chunk))
      response.on("end", () => {
        resolve({
          body: Buffer.concat(chunks).toString("utf8"),
          headers: response.headers,
          statusCode: response.statusCode,
        })
      })
    })
    outgoing.on("error", reject)
    outgoing.end()
  })
}

describe("createWorkerApplication", () => {
  it("keeps real-socket metadata bootstrapping until upstream onListen completes", async () => {
    // Given
    const bootstrapStarted = deferred()
    const allowBootstrap = deferred()
    const testUpstreamPlugin: FastifyPluginAsync<SteelBrowserConfig> = async (server) => {
      server.addHook("onListen", async () => {
        bootstrapStarted.resolve()
        await allowBootstrap.promise
      })
    }
    const upstreamPlugin = fastifyPlugin(testUpstreamPlugin, {
      name: "blocked-test-upstream",
    })
    const application = createWorkerApplication(
      parseWorkerConfig({ MANAGED_WORKER_ID: "worker-00" }),
      {
        createInstanceId: () => INSTANCE_ID,
        readActiveSession: () => ({
          id: SESSION_ID,
          status: UPSTREAM_SESSION_STATUS.IDLE,
        }),
        shutdownUpstream: async () => undefined,
        upstreamPlugin,
      },
    )
    const listen = application.server.listen({ host: "127.0.0.1", port: 0 })

    try {
      // When
      await bootstrapStarted.promise
      const origin = await listen
      const bootstrapping = await requestOrigin(origin, WORKER_META_PATH)

      // Then
      expect(bootstrapping.statusCode).toBe(503)
      expect(JSON.parse(bootstrapping.body)).toEqual({
        instanceId: INSTANCE_ID,
        status: WORKER_BOOT_STATUS.BOOTSTRAPPING,
        workerId: "worker-00",
      })
      expect(bootstrapping.headers["x-managed-worker-id"]).toBe("worker-00")
      expect(bootstrapping.headers["x-managed-worker-instance-id"]).toBe(INSTANCE_ID)

      allowBootstrap.resolve()
      await expect
        .poll(async () => (await requestOrigin(origin, WORKER_META_PATH)).statusCode)
        .toBe(200)
    } finally {
      allowBootstrap.resolve()
      await listen
      await application.server.close()
    }
  })

  it("preserves upstream CORS preflight and attaches private identity headers", async () => {
    // Given
    const upstreamPlugin: FastifyPluginAsync<SteelBrowserConfig> = async (server) => {
      server.get("/v1/health", async () => ({ status: "ok" }))
    }
    const application = createWorkerApplication(
      parseWorkerConfig({ MANAGED_WORKER_ID: "worker-01" }),
      {
        createInstanceId: () => INSTANCE_ID,
        readActiveSession: () => ({
          id: SESSION_ID,
          status: UPSTREAM_SESSION_STATUS.IDLE,
        }),
        shutdownUpstream: async () => undefined,
        upstreamPlugin,
      },
    )

    try {
      // When
      const response = await application.server.inject({
        headers: {
          "access-control-request-method": "GET",
          origin: REQUEST_ORIGIN,
        },
        method: "OPTIONS",
        url: "/v1/health",
      })

      // Then
      expect(response.statusCode).toBe(204)
      expect(response.headers["access-control-allow-origin"]).toBe(REQUEST_ORIGIN)
      expect(response.headers["x-managed-worker-id"]).toBe("worker-01")
      expect(response.headers["x-managed-worker-instance-id"]).toBe(INSTANCE_ID)
    } finally {
      await application.server.close()
    }
  })

  it("serves a bounded private active-session projection without history", async () => {
    // Given
    let activeSession: UpstreamActiveSession = {
      id: SESSION_ID,
      status: UPSTREAM_SESSION_STATUS.IDLE,
    }
    const testUpstreamPlugin: FastifyPluginAsync<SteelBrowserConfig> = async () => undefined
    const upstreamPlugin = fastifyPlugin(testUpstreamPlugin, {
      name: "active-session-test-upstream",
    })
    const application = createWorkerApplication(
      parseWorkerConfig({ MANAGED_WORKER_ID: "worker-00" }),
      {
        createInstanceId: () => INSTANCE_ID,
        readActiveSession: () => activeSession,
        shutdownUpstream: async () => undefined,
        upstreamPlugin,
      },
    )
    const listen = application.server.listen({ host: "127.0.0.1", port: 0 })

    try {
      // When
      const origin = await listen
      const emptyResponse = await requestOrigin(origin, WORKER_ACTIVE_SESSION_PATH)
      activeSession = { id: SESSION_ID, status: UPSTREAM_SESSION_STATUS.LIVE }
      const activeResponse = await requestOrigin(origin, WORKER_ACTIVE_SESSION_PATH)
      activeSession = { id: SESSION_ID, status: UPSTREAM_SESSION_STATUS.RELEASED }
      const releasedResponse = await requestOrigin(origin, WORKER_ACTIVE_SESSION_PATH)

      // Then
      expect(emptyResponse.statusCode).toBe(200)
      expect(JSON.parse(emptyResponse.body)).toEqual({
        activeSession: null,
        instanceId: INSTANCE_ID,
        workerId: "worker-00",
      })
      expect(activeResponse.statusCode).toBe(200)
      expect(JSON.parse(activeResponse.body)).toEqual({
        activeSession: { id: SESSION_ID, status: UPSTREAM_SESSION_STATUS.LIVE },
        instanceId: INSTANCE_ID,
        workerId: "worker-00",
      })
      expect(releasedResponse.statusCode).toBe(200)
      expect(JSON.parse(releasedResponse.body)).toEqual({
        activeSession: null,
        instanceId: INSTANCE_ID,
        workerId: "worker-00",
      })
      for (const response of [emptyResponse, activeResponse, releasedResponse]) {
        expect(Buffer.byteLength(response.body)).toBeLessThanOrEqual(
          WORKER_ACTIVE_SESSION_MAX_RESPONSE_BYTES,
        )
        expect(response.headers["x-managed-worker-id"]).toBe("worker-00")
        expect(response.headers["x-managed-worker-instance-id"]).toBe(INSTANCE_ID)
      }
    } finally {
      await listen
      await application.server.close()
    }
  })

  it("registers the real upstream Steel HTTP surface without adding a UI", async () => {
    // Given
    const application = createWorkerApplication(
      parseWorkerConfig({ MANAGED_WORKER_ID: "worker-01" }),
    )

    try {
      // When
      const healthResponse = await application.server.inject({
        method: "GET",
        url: "/v1/health",
      })
      const uiResponse = await application.server.inject({ method: "GET", url: "/ui" })

      // Then
      expect(healthResponse.statusCode).toBe(200)
      expect(healthResponse.json()).toEqual({ status: "ok" })
      expect(uiResponse.statusCode).toBe(404)
    } finally {
      await application.server.close()
    }
  })
})
