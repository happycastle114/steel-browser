import {
  InstanceIdSchema,
  WorkerRemoteState,
  WorkerState,
  type WorkerHttpClient,
} from "@happycastle/steel-managed-gateway"
import { describe, expect, it } from "vitest"
import { parseManagerConfig } from "../src/config.js"
import { RuntimeHealth } from "../src/health/runtime-health.js"
import { parseManagerArguments } from "../src/launch-config.js"
import { createManagerCoreComposition } from "../src/runtime/core-composition.js"
import { validManagerConfigInput, validPoolId } from "./fixtures.js"

describe("manager core composition", () => {
  it("reconciles the exact launch workers into the shared registry", async () => {
    const config = parseManagerConfig(validManagerConfigInput(), validPoolId())
    const health = new RuntimeHealth()
    const client: WorkerHttpClient = {
      create: async () => {
        throw new TypeError("create not expected")
      },
      list: async () => {
        throw new TypeError("list not expected")
      },
      probe: async (endpoint) => ({
        remoteState: WorkerRemoteState.IDLE,
        sessions: [],
        worker: {
          instanceId: InstanceIdSchema.parse(
            endpoint.workerId === "worker-00"
              ? "00000000-0000-4000-8000-000000000001"
              : "00000000-0000-4000-8000-000000000002",
          ),
          origin: endpoint.origin,
          workerId: endpoint.workerId,
        },
      }),
      release: async () => undefined,
    }
    const core = createManagerCoreComposition({
      client,
      config,
      health,
      launch: parseManagerArguments([
        "--pool-id=managed-blue-pool",
        "--worker=worker-00=http://worker-00:3000",
        "--worker=worker-01=http://worker-01:3000",
        "--public-bind=0.0.0.0:3000",
        "--health-bind=127.0.0.1:3001",
        "--create-token-key-file=/run/steel/managed-create-token-key",
        "--release-evidence-file=/run/steel/managed-release-evidence.json",
        `--release-evidence-sha256=${"a".repeat(64)}`,
      ]),
      onReconciliationError: () => undefined,
    })
    health.markInitialized()

    await core.loop.runNow()

    expect(core.provider.list().map(({ workerId }) => workerId)).toEqual([
      "worker-00",
      "worker-01",
    ])
    expect(core.registry.workers().map(({ state }) => state)).toEqual([
      WorkerState.IDLE,
      WorkerState.IDLE,
    ])
    expect(health.snapshot().ready).toBe(true)
  })
})
