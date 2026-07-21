import { describe, expect, it } from "vitest"

import { CONTROL_PLANE_FIXED, parseControlPlaneConfig } from "../src/control-plane-config.js"
import { deriveManagedServiceLimits } from "../src/managed-service-limits.js"

const config = parseControlPlaneConfig({
  maxConcurrentManagedProjects: 1,
  activeManagerCount: 1,
  activeWorkerCount: 2,
  coldStandbyProjectCount: 1,
  managerBaseP95Bytes: 100_000_000,
  accessIssuer: "https://happycastle.cloudflareaccess.com",
  accessAudience: "steel-audience",
  allowedHosts: ["steel.soungmin.kr", "steel-candidate.soungmin.kr"],
  publicOriginByHost: {
    "steel.soungmin.kr": "https://steel.soungmin.kr",
    "steel-candidate.soungmin.kr": "https://steel-candidate.soungmin.kr",
  },
  operatorServicePrincipals: ["steel-operator"],
  poolId: "managed-blue",
})

describe("managed service configuration projection", () => {
  it("projects every public, transport, retention, and capacity boundary exactly once", () => {
    // Given: the startup-validated control-plane configuration.
    // When: downstream services derive their canonical immutable limits.
    const limits = deriveManagedServiceLimits(config)
    // Then: every advertised boundary equals its authoritative config or memory ledger source.
    expect(limits).toEqual({
      publicOriginByHost: config.publicOriginByHost,
      allowedOrigins: config.allowedOrigins,
      transport: {
        httpBodyBytes: config.httpBodyBytes,
        textBytes: config.aiTextBytes,
        binaryBytes: config.aiBinaryBytes,
        resultBytes: config.memory.resultBudgetBytes,
      },
      resultTtlMs: config.aiResultTtlMs,
      capability: {
        httpHeaderBytes: CONTROL_PLANE_FIXED.httpHeaderBytes,
        httpConnectionCount: config.memory.ingressConnectionMax,
        httpConnectionReservedBytes: config.memory.httpConnectionReservationBytes,
        httpBodyCount: config.memory.ingressBodyMax,
        httpBodyReservedBytes: config.memory.httpBodyReservationBytes,
        resultCount: config.memory.resultCountLimit,
        actionTimeoutMs: config.actionTimeoutMs,
        actionCount: config.memory.actionMax,
        webSocketCount: config.memory.webSocketMax,
        webSocketReservedBytes: config.memory.webSocketReservationBytes,
      },
    })
  })

  it("freezes the complete service projection", () => {
    // Given: a service projection containing nested maps, lists, and limit groups.
    const limits = deriveManagedServiceLimits(config)
    // When: each externally shared boundary is inspected.
    const frozen = [limits, limits.publicOriginByHost, limits.allowedOrigins, limits.transport, limits.capability]
    // Then: consumers cannot mutate any shared configuration container.
    expect(frozen.every((value) => Object.isFrozen(value))).toBe(true)
  })
})
