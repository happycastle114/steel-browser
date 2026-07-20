import type { SteelBrowserConfig } from "@steel-browser/api/plugin"
import type { FastifyPluginAsync } from "fastify"
import { describe, expect, it } from "vitest"
import {
  WORKER_BOOT_STATUS,
  WORKER_META_PATH,
  parseWorkerConfig,
} from "../src/config.js"
import { createWorkerApplication } from "../src/server.js"
import { deferred } from "./test-support.js"

const INSTANCE_ID = "11223344-5566-4788-99aa-bbccddeeff00"

describe("createWorkerApplication", () => {
  it("does not report ready before the upstream plugin finishes bootstrap", async () => {
    // Given
    const bootstrapStarted = deferred()
    const allowBootstrap = deferred()
    const upstreamPlugin: FastifyPluginAsync<SteelBrowserConfig> = async (server) => {
      bootstrapStarted.resolve()
      await allowBootstrap.promise
      server.get("/v1/health", async () => ({ status: "ok" }))
    }
    const application = createWorkerApplication(
      parseWorkerConfig({ MANAGED_WORKER_ID: "worker-00" }),
      { createInstanceId: () => INSTANCE_ID, upstreamPlugin },
    )
    let responseSettled = false

    // When
    const responsePromise = application.server
      .inject({ method: "GET", url: WORKER_META_PATH })
      .then((response) => {
        responseSettled = true
        return response
      })
    await bootstrapStarted.promise

    // Then
    expect(responseSettled).toBe(false)
    allowBootstrap.resolve()
    const response = await responsePromise
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      instanceId: INSTANCE_ID,
      status: WORKER_BOOT_STATUS.READY,
      workerId: "worker-00",
    })
    await application.server.close()
  })

  it("registers the real upstream Steel plugin without adding a UI", async () => {
    // Given
    const application = createWorkerApplication(
      parseWorkerConfig({ MANAGED_WORKER_ID: "worker-01" }),
    )

    // When
    const healthResponse = await application.server.inject({
      method: "GET",
      url: "/v1/health",
    })
    const uiResponse = await application.server.inject({ method: "GET", url: "/ui" })

    // Then
    expect(healthResponse.statusCode).toBe(200)
    expect(healthResponse.json()).toEqual({ status: "ok" })
    expect(application.server.server.listenerCount("upgrade")).toBeGreaterThan(0)
    expect(uiResponse.statusCode).toBe(404)
    await application.server.close()
  })
})
