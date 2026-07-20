import { describe, expect, it } from "vitest"
import {
  StaticWorkerConfigSchema,
  StaticWorkerProvider,
  WORKER_DISCOVERY_MODE,
  WorkerDiscoveryConfigurationError,
  WorkerDiscoveryConfigSchema,
  createWorkerProvider,
} from "../src/index.js"

const staticWorkers = [
  { workerId: "worker-00", origin: "http://worker-00:3000" },
  { workerId: "worker-01", origin: "http://worker-01:3000" },
] as const

describe("worker discovery provider selection", () => {
  it("selects the fixed static provider from the overlay-bound mode", () => {
    const provider = createWorkerProvider({
      discoveryMode: WORKER_DISCOVERY_MODE.STATIC_CONFIG,
      workers: staticWorkers,
    })

    expect(provider).toBeInstanceOf(StaticWorkerProvider)
    expect(provider.list()).toEqual(staticWorkers)
  })

  it("rejects DNS provider input before a provider can be selected", () => {
    const input = {
      discoveryMode: "DNS_REPLICA",
      workers: staticWorkers,
    }

    expect(() => createWorkerProvider(input)).toThrow(WorkerDiscoveryConfigurationError)
    expect(WorkerDiscoveryConfigSchema.safeParse(input).success).toBe(false)
  })

  it("rejects selectors and non-static endpoint sources", () => {
    expect(() =>
      createWorkerProvider({
        discoveryMode: WORKER_DISCOVERY_MODE.STATIC_CONFIG,
        selector: { service: "workers" },
        workers: staticWorkers,
      }),
    ).toThrow(WorkerDiscoveryConfigurationError)
  })

  it("rejects a non-exact service port instead of selecting it", () => {
    expect(() =>
      createWorkerProvider({
        discoveryMode: WORKER_DISCOVERY_MODE.STATIC_CONFIG,
        workers: [
          { workerId: "worker-00", origin: "http://worker-00:3001" },
          { workerId: "worker-01", origin: "http://worker-01:3000" },
        ],
      }),
    ).toThrow(WorkerDiscoveryConfigurationError)
  })

  it("revalidates untyped static configuration at the factory boundary", () => {
    const config = StaticWorkerConfigSchema.parse({ workers: staticWorkers })
    expect(
      createWorkerProvider({
        discoveryMode: WORKER_DISCOVERY_MODE.STATIC_CONFIG,
        workers: config.workers,
      }),
    ).toEqual(new StaticWorkerProvider(config))
  })
})
