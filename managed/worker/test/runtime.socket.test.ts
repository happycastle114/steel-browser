import { get } from "node:http"
import type { SteelBrowserConfig } from "@steel-browser/api/plugin"
import type { FastifyPluginAsync } from "fastify"
import { describe, expect, it } from "vitest"
import {
  WORKER_BOOT_STATUS,
  WORKER_META_PATH,
} from "../src/config.js"
import { startWorker } from "../src/runtime.js"
import { SHUTDOWN_OUTCOME } from "../src/shutdown.js"
import { FakeSignalControl, TEST_NODE_RUNTIME_VERSION } from "./test-support.js"

const INSTANCE_ID = "11223344-5566-4788-99aa-bbccddeeff00"

type HttpResult = {
  readonly body: string
  readonly headers: Readonly<Record<string, string | string[] | undefined>>
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
          headers: response.headers,
          statusCode: response.statusCode,
        })
      })
    })
    outgoing.on("error", reject)
  })
}

describe("managed worker fixed listener", () => {
  it("serves upstream health and private identity with failure-safe teardown", async () => {
    // Given
    const signals = new FakeSignalControl()
    const upstreamPlugin: FastifyPluginAsync<SteelBrowserConfig> = async (server) => {
      server.get("/v1/health", async () => ({ status: "ok" }))
    }
    const runtime = await startWorker(
      { MANAGED_WORKER_ID: "worker-00", NODE_ENV: "test" },
      {
        nodeRuntimeVersion: TEST_NODE_RUNTIME_VERSION,
        server: {
          createInstanceId: () => INSTANCE_ID,
          shutdownUpstream: async () => undefined,
          upstreamPlugin,
        },
        signals,
      },
    )

    try {
      // When
      const health = await request("/v1/health")
      const metadata = await request(WORKER_META_PATH)

      // Then
      expect(health.statusCode).toBe(200)
      expect(JSON.parse(health.body)).toEqual({ status: "ok" })
      expect(health.headers["x-managed-worker-id"]).toBe("worker-00")
      expect(health.headers["x-managed-worker-instance-id"]).toBe(INSTANCE_ID)
      expect(metadata.statusCode).toBe(200)
      expect(JSON.parse(metadata.body)).toEqual({
        instanceId: INSTANCE_ID,
        status: WORKER_BOOT_STATUS.READY,
        workerId: "worker-00",
      })
    } finally {
      signals.emit("SIGTERM")
      expect(await runtime.shutdown.completion).toBe(SHUTDOWN_OUTCOME.CLOSED)
    }
  })
})
