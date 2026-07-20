import { describe, expect, it } from "vitest"
import {
  StaticWorkerConfigSchema,
  StaticWorkerProvider,
} from "../src/index.js"

describe("StaticWorkerProvider", () => {
  it("returns the two configured workers in stable order", () => {
    // Given
    const config = StaticWorkerConfigSchema.parse({
      workers: [
        { workerId: "worker-01", origin: "http://worker-01:3000" },
        { workerId: "worker-00", origin: "http://worker-00:3000" },
      ],
    })

    // When
    const workers = new StaticWorkerProvider(config).list()

    // Then
    expect(workers.map(({ workerId }) => workerId)).toEqual(["worker-00", "worker-01"])
  })

  it.each([
    {
      name: "a duplicate worker id",
      workers: [
        { workerId: "worker-00", origin: "http://worker-00:3000" },
        { workerId: "worker-00", origin: "http://worker-01:3000" },
      ],
    },
    {
      name: "a public origin",
      workers: [
        { workerId: "worker-00", origin: "https://example.com" },
        { workerId: "worker-01", origin: "http://worker-01:3000" },
      ],
    },
    {
      name: "a worker outside the fixed two-worker topology",
      workers: [
        { workerId: "worker-00", origin: "http://worker-00:3000" },
        { workerId: "worker-02", origin: "http://worker-02:3000" },
      ],
    },
    {
      name: "a localhost origin",
      workers: [
        { workerId: "worker-00", origin: "http://127.0.0.1:3000" },
        { workerId: "worker-01", origin: "http://worker-01:3000" },
      ],
    },
    {
      name: "an RFC1918 origin",
      workers: [
        { workerId: "worker-00", origin: "http://192.168.1.20:3000" },
        { workerId: "worker-01", origin: "http://worker-01:3000" },
      ],
    },
    {
      name: "a wrong worker port",
      workers: [
        { workerId: "worker-00", origin: "http://worker-00:3001" },
        { workerId: "worker-01", origin: "http://worker-01:3000" },
      ],
    },
    {
      name: "swapped worker hostnames",
      workers: [
        { workerId: "worker-00", origin: "http://worker-01:3000" },
        { workerId: "worker-01", origin: "http://worker-00:3000" },
      ],
    },
  ])("rejects $name at the configuration boundary", ({ workers }) => {
    // Given / When
    const parsed = StaticWorkerConfigSchema.safeParse({ workers })

    // Then
    expect(parsed.success).toBe(false)
  })

  it("freezes validated endpoints and the provider-owned topology", () => {
    const config = StaticWorkerConfigSchema.parse({
      workers: [
        { workerId: "worker-00", origin: "http://worker-00:3000" },
        { workerId: "worker-01", origin: "http://worker-01:3000" },
      ],
    })
    const workers = new StaticWorkerProvider(config).list()

    expect(Object.isFrozen(config)).toBe(true)
    expect(Object.isFrozen(config.workers)).toBe(true)
    expect(config.workers.every(Object.isFrozen)).toBe(true)
    expect(Object.isFrozen(workers)).toBe(true)
    expect(Reflect.set(config.workers[0], "origin", "http://worker-01:3000")).toBe(false)
    expect(Reflect.set(workers, 0, workers[1])).toBe(false)
    expect(workers.map(({ workerId }) => workerId)).toEqual(["worker-00", "worker-01"])
  })

  it("revalidates untyped JavaScript input at the provider constructor", () => {
    const constructProvider = () =>
      Reflect.construct(StaticWorkerProvider, [
        {
          workers: [
            { workerId: "worker-00", origin: "https://example.com" },
            { workerId: "worker-01", origin: "http://worker-01:3000" },
          ],
        },
      ])

    expect(constructProvider).toThrow()
  })
})
