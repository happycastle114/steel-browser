import { describe, expect, it } from "vitest"

import {
  DISCOVERY_MODE,
  MANAGED_STATIC_WORKER_ENDPOINTS,
  ManagedWorkerDiscoveryConfigSchema,
} from "../src/index.js"

const validConfig = {
  discoveryMode: DISCOVERY_MODE.STATIC_CONFIG,
  staticWorkerEndpoints: MANAGED_STATIC_WORKER_ENDPOINTS,
} as const

describe("managed worker discovery contract", () => {
  it("accepts the canonical static topology", () => {
    expect(ManagedWorkerDiscoveryConfigSchema.safeParse(validConfig).success).toBe(true)
  })

  it.each([
    {
      name: "duplicate endpoint",
      staticWorkerEndpoints: [
        MANAGED_STATIC_WORKER_ENDPOINTS[0],
        MANAGED_STATIC_WORKER_ENDPOINTS[0],
      ],
    },
    {
      name: "non-exact service port",
      staticWorkerEndpoints: [
        "worker-00=http://worker-00:3001",
        MANAGED_STATIC_WORKER_ENDPOINTS[1],
      ],
    },
  ])("rejects $name in one schema parse", ({ staticWorkerEndpoints }) => {
    expect(
      ManagedWorkerDiscoveryConfigSchema.safeParse({
        ...validConfig,
        staticWorkerEndpoints,
      }).success,
    ).toBe(false)
  })
})
