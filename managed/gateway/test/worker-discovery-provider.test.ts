import { describe, expect, it } from "vitest"
import {
  DISCOVERY_MODE,
  MANAGED_STATIC_WORKER_ENDPOINTS,
  StaticWorkerProvider,
  WorkerDiscoveryConfigurationError,
  WorkerDiscoveryConfigSchema,
  createWorkerProvider,
} from "../src/index.js"

const staticConfig = {
  discoveryMode: DISCOVERY_MODE.STATIC_CONFIG,
  staticWorkerEndpoints: MANAGED_STATIC_WORKER_ENDPOINTS,
} as const

describe("worker discovery provider selection", () => {
  it("selects the fixed static provider from the shared topology contract", () => {
    const provider = createWorkerProvider(staticConfig)

    expect(provider).toBeInstanceOf(StaticWorkerProvider)
    expect(
      provider.list().map(({ workerId, origin }) => `${workerId}=${origin}`),
    ).toEqual([...MANAGED_STATIC_WORKER_ENDPOINTS])
  })

  it("rejects DNS provider input before a provider can be selected", () => {
    const input = {
      discoveryMode: "DNS_REPLICA",
      staticWorkerEndpoints: MANAGED_STATIC_WORKER_ENDPOINTS,
    }

    expect(() => createWorkerProvider(input)).toThrow(WorkerDiscoveryConfigurationError)
    expect(WorkerDiscoveryConfigSchema.safeParse(input).success).toBe(false)
  })

  it("rejects selectors and non-static endpoint sources", () => {
    expect(() =>
      createWorkerProvider({
        ...staticConfig,
        selector: { service: "workers" },
      }),
    ).toThrow(WorkerDiscoveryConfigurationError)
  })

  it("rejects duplicate endpoints in the canonical schema", () => {
    const input = {
      ...staticConfig,
      staticWorkerEndpoints: [
        MANAGED_STATIC_WORKER_ENDPOINTS[0],
        MANAGED_STATIC_WORKER_ENDPOINTS[0],
      ],
    }

    expect(WorkerDiscoveryConfigSchema.safeParse(input).success).toBe(false)
    expect(() => createWorkerProvider(input)).toThrow(WorkerDiscoveryConfigurationError)
  })

  it("rejects an illegal service port in the canonical schema", () => {
    const input = {
      ...staticConfig,
      staticWorkerEndpoints: [
        "worker-00=http://worker-00:3001",
        MANAGED_STATIC_WORKER_ENDPOINTS[1],
      ],
    }

    expect(WorkerDiscoveryConfigSchema.safeParse(input).success).toBe(false)
    expect(() => createWorkerProvider(input)).toThrow(WorkerDiscoveryConfigurationError)
  })
})
