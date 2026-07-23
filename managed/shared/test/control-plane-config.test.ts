import { describe, expect, it } from "vitest"

import {
  CONTROL_PLANE_DEFAULTS,
  CONTROL_PLANE_FIXED,
  deriveManagerMemoryBudget,
  parseControlPlaneConfig,
} from "../src/control-plane-config.js"
import { HandoverProofSchema, computeDrainSafeAt, handoverIsSafe } from "../src/handover-policy.js"
import { RETRY_AFTER_REASON, retryAfterSeconds } from "../src/retry-after.js"

const validInput = {
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
}

describe("centralized control-plane configuration", () => {
  it("derives five disjoint manager memory ledgers and minimum counts", () => {
    // Given: the default manager cgroup limit.
    // When: deterministic memory budgets are derived.
    const budget = deriveManagerMemoryBudget(CONTROL_PLANE_DEFAULTS.managerMemoryMiB)
    // Then: all bytes are partitioned and every count meets its minimum.
    expect(
      budget.resultBudgetBytes + budget.webSocketBudgetBytes + budget.actionBudgetBytes + budget.ingressBudgetBytes,
    ).toBe(budget.dynamicLimitBytes)
    expect(budget.ingressConnectionMax).toBeGreaterThanOrEqual(32)
    expect(budget.ingressBodyMax).toBeGreaterThanOrEqual(2)
    expect(budget.actionMax).toBeGreaterThanOrEqual(1)
    expect(budget.webSocketReservationBytes).toBe(
      (2 * CONTROL_PLANE_DEFAULTS.webSocketMessageBytes) +
      (2 * CONTROL_PLANE_DEFAULTS.webSocketBufferBytes) +
      CONTROL_PLANE_FIXED.webSocketOverheadBytes,
    )
    expect(budget.webSocketMax).toBe(2)
    expect(budget.resultReservationBytes).toBe(CONTROL_PLANE_DEFAULTS.aiBinaryBytes)
    expect(budget.resultCountLimit).toBe(CONTROL_PLANE_DEFAULTS.aiResultMax)
  })

  it("parses the single-active two-worker cold-standby topology", () => {
    // Given: the overlay-authoritative normalized input.
    // When: configuration is parsed before listener construction.
    const config = parseControlPlaneConfig(validInput)
    // Then: runtime cardinality and boot mode are fixed.
    expect(config.topology).toEqual({
      maxConcurrentManagedProjects: 1,
      activeManagerCount: 1,
      activeWorkerCount: 2,
      coldStandbyProjectCount: 1,
    })
    expect(config.bootMode).toBe(CONTROL_PLANE_FIXED.bootMode)
    expect(config.additionalAccessAudiences).toEqual([])
    expect(config.operatorUserEmails).toEqual([])
    expect(config.allowedOrigins).toEqual(Object.values(validInput.publicOriginByHost))
    expect(config.legacyQuiescenceMs).toBe(120_000)
  })

  it("normalizes operator user emails and rejects duplicates", () => {
    // Given: a production Owner email is explicitly allowlisted.
    const config = parseControlPlaneConfig({
      ...validInput,
      operatorUserEmails: ["Operator@Example.com"],
    })

    // Then: authorization comparisons use one canonical form.
    expect(config.operatorUserEmails).toEqual(["operator@example.com"])
    expect(() => parseControlPlaneConfig({
      ...validInput,
      operatorUserEmails: ["Operator@Example.com", "operator@example.com"],
    })).toThrow()
  })

  it("accepts unique additional Access audiences and rejects duplicates", () => {
    // Given: the UI and MCP endpoints use distinct Access applications.
    const config = parseControlPlaneConfig({
      ...validInput,
      additionalAccessAudiences: ["steel-mcp-audience"],
    })

    // Then: both audiences remain explicit in the parsed configuration.
    expect(config.additionalAccessAudiences).toEqual(["steel-mcp-audience"])
    expect(() => parseControlPlaneConfig({
      ...validInput,
      additionalAccessAudiences: [validInput.accessAudience],
    })).toThrow()
  })

  it.each([
    ["maxConcurrentManagedProjects", 2],
    ["activeManagerCount", 2],
    ["activeWorkerCount", 1],
    ["activeWorkerCount", 3],
    ["coldStandbyProjectCount", 0],
    ["managerMemoryMiB", 1_023],
    ["managerMemoryMiB", 2049],
    ["queueMax", 0],
    ["queueMax", 1001],
    ["ticketTtlMs", 9_999],
    ["ticketTtlMs", 600_001],
    ["idempotencyTtlMs", 59_999],
    ["idempotencyTtlMs", 3_600_001],
    ["reconcileMs", 999],
    ["reconcileMs", 30_001],
    ["httpBodyBytes", 65_535],
    ["httpBodyBytes", 8_388_609],
    ["aiTextBytes", 65_535],
    ["aiBinaryBytes", 1_048_575],
    ["webSocketMessageBytes", 33_554_433],
  ] as const)("rejects out-of-bound %s=%s", (key, value) => {
    // Given: an otherwise valid configuration with one boundary mutation.
    const input = { ...validInput, [key]: value }
    // When: the source is parsed.
    const parse = () => parseControlPlaneConfig(input)
    // Then: startup fails before listen.
    expect(parse).toThrow()
  })

  it("rejects a manager base measurement outside the 80 percent invariant", () => {
    // Given: a base measurement that leaves no room for fixed ledgers and tmpfs.
    const input = { ...validInput, managerBaseP95Bytes: 400_000_000 }
    // When: configuration is parsed.
    const parse = () => parseControlPlaneConfig(input)
    // Then: startup fails before listen.
    expect(parse).toThrow()
  })

  it("recomputes safeAt from the later drain or mutation timestamp", () => {
    // Given: a drain entered before a later terminal mutation.
    // When: the handover fence timestamp is derived.
    const safeAt = computeDrainSafeAt({ drainEnteredAtMs: 1_000, lastAcceptedOrTerminalAtMs: 4_000, idempotencyTtlMs: 600_000 })
    // Then: the later mutation owns the complete replay window.
    expect(safeAt).toBe(604_000)
  })

  it("requires zero blocking work and an unchanged elapsed fence", () => {
    // Given: a draining pool whose time fence elapsed but one socket remains.
    const proof = HandoverProofSchema.parse({
      nowMs: 700_000,
      safeAtMs: 604_000,
      drainEnteredAtMs: 1_000,
      lastAcceptedOrTerminalAtMs: 4_000,
      idempotencyTtlMs: 600_000,
      drainingManagerInstanceId: "118f56c8-6f7a-4c45-9e5d-77adff18f7ac",
      currentManagerInstanceId: "118f56c8-6f7a-4c45-9e5d-77adff18f7ac",
      blocking: { queued: 0, reserved: 0, starting: 0, live: 0, releasing: 0, uncertain: 0, httpCreates: 0, webSockets: 1 },
    })
    // When: handover safety is evaluated.
    const safe = handoverIsSafe(proof)
    // Then: the slot remains unsafe.
    expect(safe).toBe(false)
  })

  it.each([
    [RETRY_AFTER_REASON.RECONCILE, { reconcileMs: 5_000 }, 5],
    [RETRY_AFTER_REASON.FIXED_CAPACITY, {}, 60],
    [RETRY_AFTER_REASON.SNAPSHOT_CAPACITY, {}, 1],
    [RETRY_AFTER_REASON.WINDOW_RESET, { nowMs: 1_000, expiresAtMs: 1_001 }, 1],
    [RETRY_AFTER_REASON.WINDOW_RESET, { nowMs: 1_000, expiresAtMs: 3_001 }, 3],
  ] as const)("derives deterministic Retry-After row %#", (reason, input, expected) => {
    // Given: one declared retry reason and clock input.
    // When: the header/body integer is derived once.
    const seconds = retryAfterSeconds({ reason, ...input })
    // Then: the exact table value is returned.
    expect(seconds).toBe(expected)
  })
})
