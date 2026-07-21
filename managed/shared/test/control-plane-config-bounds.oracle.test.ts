import { describe, expect, it } from "vitest"

import {
  CONFIGURABLE_NUMERIC_BOUNDS,
  CONTROL_PLANE_FIXED,
  parseControlPlaneConfig,
} from "../src/control-plane-config.js"

const validInput = {
  maxConcurrentManagedProjects: 1,
  activeManagerCount: 1,
  activeWorkerCount: 2,
  coldStandbyProjectCount: 1,
  managerMemoryMiB: 2_048,
  managerBaseP95Bytes: 100_000_000,
  accessIssuer: "https://happycastle.cloudflareaccess.com",
  accessAudience: "steel-audience",
  allowedHosts: ["steel.soungmin.kr"],
  publicOriginByHost: { "steel.soungmin.kr": "https://steel.soungmin.kr" },
  operatorServicePrincipals: ["steel-operator"],
  poolId: "managed-blue",
}

const EXPECTED_BOUNDS = {
  managerMemoryMiB: { minimum: 512, maximum: 2_048 }, managerCpuLimit: { minimum: 0.5, maximum: 4 },
  workerMemoryMiB: { minimum: 1_536, maximum: 8_192 }, workerMemoryReservationMiB: { minimum: 768, maximum: 8_192 },
  workerCpuLimit: { minimum: 1, maximum: 8 }, workerShmMiB: { minimum: 512, maximum: 4_096 },
  queueMax: { minimum: 1, maximum: 1_000 }, ticketTtlMs: { minimum: 10_000, maximum: 600_000 },
  idempotencyTtlMs: { minimum: 60_000, maximum: 3_600_000 }, listSnapshotMax: { minimum: 10, maximum: 1_000 },
  listSnapshotTtlMs: { minimum: 5_000, maximum: 120_000 }, reconcileMs: { minimum: 1_000, maximum: 30_000 },
  probeTimeoutMs: { minimum: 500, maximum: 10_000 }, createTimeoutMs: { minimum: 5_000, maximum: 120_000 },
  releaseTimeoutMs: { minimum: 2_000, maximum: 60_000 }, actionTimeoutMs: { minimum: 1_000, maximum: 120_000 },
  drainTimeoutMs: { minimum: 5_000, maximum: 120_000 }, httpBodyBytes: { minimum: 65_536, maximum: 8_388_608 },
  aiTextBytes: { minimum: 65_536, maximum: 8_388_608 }, aiBinaryBytes: { minimum: 1_048_576, maximum: 33_554_432 },
  aiResultTtlMs: { minimum: 10_000, maximum: 300_000 }, aiResultMax: { minimum: 1, maximum: 1_000 },
  webSocketMessageBytes: { minimum: 65_536, maximum: 33_554_432 }, webSocketBufferBytes: { minimum: 65_536, maximum: 8_388_608 },
  webSocketIdleMs: { minimum: 10_000, maximum: 600_000 }, rateGeneralPerMinute: { minimum: 1, maximum: 600 },
  rateCreatePerMinute: { minimum: 1, maximum: 120 }, rateSubjectMax: { minimum: 100, maximum: 50_000 },
  terminalSessionMax: { minimum: 100, maximum: 10_000 }, terminalSessionTtlMs: { minimum: 60_000, maximum: 3_600_000 },
  accessMaxTokenTtlSeconds: { minimum: 300, maximum: 86_400 },
} as const

function inputAt(key: string, value: number): Readonly<Record<string, unknown>> {
  const input: Record<string, unknown> = { ...validInput, [key]: value }
  if (key === "workerMemoryReservationMiB" && value > 2_048) input.workerMemoryMiB = value
  if (key === "httpBodyBytes" && value < 1_048_576) input.aiTextBytes = value
  if (key === "aiTextBytes" && value > 2_097_152) input.httpBodyBytes = value
  return input
}

const boundaryCases = Object.entries(EXPECTED_BOUNDS).map(([key, bounds]) => ({ key, ...bounds }))

describe("independent numeric configuration oracle", () => {
  it("locks the exact public listener bind", () => {
    // Given: the centralized fixed listener configuration.
    // When: the public bind is inspected.
    // Then: it exposes exactly the approved all-interface port.
    expect(CONTROL_PLANE_FIXED.publicBind).toBe("0.0.0.0:3000")
  })

  it("locks every numeric minimum and maximum", () => {
    // Given: an independently declared bound table.
    // When: the centralized production table is compared as a whole.
    // Then: no numeric key or endpoint may drift.
    expect(CONFIGURABLE_NUMERIC_BOUNDS).toEqual(EXPECTED_BOUNDS)
  })

  it.each(boundaryCases)("accepts both endpoints for $key", ({ key, minimum, maximum }) => {
    // Given: otherwise valid inputs at one exact minimum and maximum.
    // When: both pass through the startup configuration boundary.
    const results = [minimum, maximum].map((value) => parseControlPlaneConfig(inputAt(key, value))[key])
    // Then: both inclusive endpoints are retained exactly.
    expect(results).toEqual([minimum, maximum])
  })

  it.each(boundaryCases)("rejects values outside both endpoints for $key", ({ key, minimum, maximum }) => {
    // Given: values immediately below and above one declared bound.
    const step = Number.isInteger(minimum) ? 1 : 0.1
    // When: each crosses the startup configuration boundary.
    const parse = [minimum - step, maximum + step].map((value) => () => parseControlPlaneConfig(inputAt(key, value)))
    // Then: both out-of-range values fail closed.
    for (const candidate of parse) expect(candidate).toThrow()
  })
})
