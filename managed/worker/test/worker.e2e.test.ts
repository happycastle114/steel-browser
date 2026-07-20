import { get } from "node:http"
import type { SteelBrowserConfig } from "@steel-browser/api/plugin"
import type { FastifyPluginAsync } from "fastify"
import { describe, expect, it } from "vitest"
import { WORKER_BOOT_STATUS, WORKER_META_PATH } from "../src/config.js"
import { startWorker } from "../src/runtime.js"
import { SHUTDOWN_OUTCOME } from "../src/shutdown.js"
import { FakeSignalControl } from "./test-support.js"

const INSTANCE_ID = "11223344-5566-4788-99aa-bbccddeeff00"

type HttpResult = {
  readonly body: string
  readonly statusCode: number | undefined
}

function request(path: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const outgoing = get(`http://127.0.0.1:3000${path}`, (response) => {
      const chunks: Buffer[] = []
      response.on("data", (chunk: Buffer) => chunks.push(chunk))
      response.on("end", () => {
        resolve({
          body: Buffer.concat(chunks).toString("utf8"),
          statusCode: response.statusCode,
        })
      })
    })
    outgoing.on("error", reject)
  })
}

describe("managed worker runtime", () => {
  it("serves upstream health and private identity on the fixed listener", async () => {
    // Given
    const signals = new FakeSignalControl()
    const upstreamPlugin: FastifyPluginAsync<SteelBrowserConfig> = async (server) => {
      server.get("/v1/health", async () => ({ status: "ok" }))
    }
    const runtime = await startWorker(
      { MANAGED_WORKER_ID: "worker-00", NODE_ENV: "test" },
      {
        server: { createInstanceId: () => INSTANCE_ID, upstreamPlugin },
        signals,
      },
    )

    // When
    const health = await request("/v1/health")
    const metadata = await request(WORKER_META_PATH)
    signals.emit("SIGTERM")
    const shutdown = await runtime.shutdown.completion

    // Then
    expect(health.statusCode).toBe(200)
    expect(JSON.parse(health.body)).toEqual({ status: "ok" })
    expect(metadata.statusCode).toBe(200)
    expect(JSON.parse(metadata.body)).toEqual({
      instanceId: INSTANCE_ID,
      status: WORKER_BOOT_STATUS.READY,
      workerId: "worker-00",
    })
    expect(shutdown).toBe(SHUTDOWN_OUTCOME.CLOSED)
  })
})
