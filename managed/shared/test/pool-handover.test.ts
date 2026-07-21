import { describe, expect, it } from "vitest"

import { CONTROL_PLANE_API_VERSION } from "../src/control-plane-contract.js"
import { parseControlPlaneConfig } from "../src/control-plane-config.js"
import { CONTROL_PLANE_FIXED } from "../src/control-plane-config-values.js"
import { HANDOVER_MODE, MANAGER_MODE, MANAGER_MODE_CAUSE } from "../src/control-plane-vocabulary.js"
import { PoolSchema, poolSchemaForConfig } from "../src/pool-resource.js"

const managerInstanceId = "118f56c8-6f7a-4c45-9e5d-77adff18f7ac"
const zeroBlocking = {
  queued: 0,
  reserved: 0,
  starting: 0,
  live: 0,
  releasing: 0,
  uncertain: 0,
  httpCreates: 0,
  webSockets: 0,
}
const blockingKeys = [
  "queued",
  "reserved",
  "starting",
  "live",
  "releasing",
  "uncertain",
  "httpCreates",
  "webSockets",
] satisfies readonly (keyof typeof zeroBlocking)[]

const validConfigInput = {
  maxConcurrentManagedProjects: 1,
  activeManagerCount: 1,
  activeWorkerCount: 2,
  coldStandbyProjectCount: 1,
  managerBaseP95Bytes: 100_000_000,
  accessIssuer: "https://happycastle.cloudflareaccess.com",
  accessAudience: "steel-audience",
  allowedHosts: ["steel.soungmin.kr"],
  publicOriginByHost: { "steel.soungmin.kr": "https://steel.soungmin.kr" },
  operatorServicePrincipals: ["steel-operator"],
  poolId: "managed-blue",
}
const config = parseControlPlaneConfig(validConfigInput)
const memoryLedger = (limitBytes: number, limitCount: number) => ({ reservedBytes: 0, limitBytes, reservedCount: 0, limitCount })

const validPool = {
  apiVersion: CONTROL_PLANE_API_VERSION,
  poolId: "managed-blue",
  managerInstanceId,
  mode: MANAGER_MODE.DRAINING,
  handover: {
    mode: HANDOVER_MODE.DRAINING,
    safe: false,
    managerInstanceId,
    cause: MANAGER_MODE_CAUSE.RECOVERY,
    drainEnteredAt: "2026-07-20T00:00:00.000Z",
    lastMutationAt: "2026-07-20T00:00:00.000Z",
    idempotencyTtlMs: 600_000,
    safeAt: "2026-07-20T00:10:00.000Z",
    blocking: zeroBlocking,
  },
  counts: {
    physical: 2,
    usableReachable: 2,
    reconciledIdle: 2,
    busy: 0,
    unavailable: 0,
    byState: {
      discovered: 0,
      reachable: 0,
      idle: 2,
      reserved: 0,
      starting: 0,
      live: 0,
      releasing: 0,
      unreachable: 0,
      quarantined: 0,
      draining: 0,
    },
  },
  queue: { depth: 0, max: config.queueMax, oldestWaitMs: 0 },
  memory: {
    managerLimitBytes: config.memory.managerLimitBytes,
    baseP95Bytes: config.managerBaseP95Bytes,
    tmpfsLimitBytes: CONTROL_PLANE_FIXED.managerTmpfsLimitBytes,
    snapshotLimitBytes: CONTROL_PLANE_FIXED.listSnapshotBytes,
    dynamicLimitBytes: config.memory.dynamicLimitBytes,
    result: memoryLedger(config.memory.resultBudgetBytes, config.memory.resultCountLimit),
    action: memoryLedger(config.memory.actionBudgetBytes, config.memory.actionMax),
    webSocket: memoryLedger(config.memory.webSocketBudgetBytes, config.memory.webSocketMax),
    ingressConnection: memoryLedger(config.memory.ingressConnectionBudgetBytes, config.memory.ingressConnectionMax),
    ingressBody: memoryLedger(config.memory.ingressBodyBudgetBytes, config.memory.ingressBodyMax),
  },
  generatedAt: "2026-07-20T00:00:01.000Z",
}

describe("configuration-bound pool handover", () => {
  it("accepts the default exact fence and rejects a self-reported shorter TTL", () => {
    // Given: a valid default proof and a self-consistent 60-second mutant.
    const configBoundSchema = poolSchemaForConfig(config)
    const forged = {
      ...validPool,
      handover: {
        ...validPool.handover,
        idempotencyTtlMs: 60_000,
        safeAt: "2026-07-20T00:01:00.000Z",
      },
    }
    // When: both cross the default public Pool boundary.
    const accepted = PoolSchema.safeParse(validPool)
    const rejected = PoolSchema.safeParse(forged)
    const configBoundAccepted = configBoundSchema.safeParse(validPool)
    const configBoundRejected = configBoundSchema.safeParse(forged)
    // Then: only the configured 600-second proof is accepted.
    expect(accepted.success).toBe(true)
    expect(rejected.success).toBe(false)
    expect(configBoundAccepted.success).toBe(true)
    expect(configBoundRejected.success).toBe(false)
  })

  it("binds a non-default fence to the effective parsed configuration", () => {
    // Given: startup parsed an explicit 60-second idempotency TTL.
    const nonDefaultConfig = parseControlPlaneConfig({ ...validConfigInput, idempotencyTtlMs: 60_000 })
    const schema = poolSchemaForConfig(nonDefaultConfig)
    const configuredPool = {
      ...validPool,
      handover: {
        ...validPool.handover,
        idempotencyTtlMs: 60_000,
        safeAt: "2026-07-20T00:01:00.000Z",
      },
    }
    const wrongWireTtl = {
      ...configuredPool,
      handover: { ...configuredPool.handover, idempotencyTtlMs: 600_000 },
    }
    // When: configured and default proof variants cross that bound schema.
    const accepted = schema.safeParse(configuredPool)
    const rejected = schema.safeParse(wrongWireTtl)
    // Then: the effective config, not a caller-selected proof value, owns the fence.
    expect(accepted.success).toBe(true)
    expect(rejected.success).toBe(false)
  })

  it("rejects queue max drift on both adjacent values", () => {
    const schema = poolSchemaForConfig(config)
    for (const delta of [-1, 1]) {
      const pool = { ...validPool, queue: { ...validPool.queue, max: config.queueMax + delta } }
      expect(schema.safeParse(pool).success).toBe(false)
    }
  })

  it.each(["managerLimitBytes", "baseP95Bytes", "tmpfsLimitBytes", "snapshotLimitBytes", "dynamicLimitBytes"] as const)(
    "rejects %s drift on both adjacent values",
    (field) => {
      const schema = poolSchemaForConfig(config)
      for (const delta of [-1, 1]) {
        const pool = { ...validPool, memory: { ...validPool.memory, [field]: validPool.memory[field] + delta } }
        expect(schema.safeParse(pool).success).toBe(false)
      }
    },
  )

  it("rejects every ledger limit drift on both adjacent values", () => {
    const schema = poolSchemaForConfig(config)
    for (const name of ["result", "action", "webSocket", "ingressConnection", "ingressBody"] as const) for (const key of ["limitBytes", "limitCount"] as const) for (const delta of [-1, 1]) {
      const ledger = validPool.memory[name]
      const pool = { ...validPool, memory: { ...validPool.memory, [name]: { ...ledger, [key]: ledger[key] + delta } } }
      expect(schema.safeParse(pool).success).toBe(false)
    }
  })

  it("accepts safe handover only after the exact fence for the unchanged manager", () => {
    // Given: a zero-blocking drain observed at its configured fence.
    const pool = { ...validPool, handover: { ...validPool.handover, safe: true }, generatedAt: validPool.handover.safeAt }
    // When: the pool projection crosses the default boundary.
    const result = PoolSchema.safeParse(pool)
    // Then: the fully elapsed, instance-bound handover is accepted.
    expect(result.success).toBe(true)
  })

  it.each([
    { ...validPool, handover: { ...validPool.handover, safe: true }, generatedAt: "2026-07-20T00:09:59.999Z" },
    { ...validPool, handover: { ...validPool.handover, safe: true, managerInstanceId: "918f56c8-6f7a-4c45-9e5d-77adff18f7ac" }, generatedAt: validPool.handover.safeAt },
    { ...validPool, handover: { ...validPool.handover, safe: true, safeAt: "2026-07-20T00:09:59.999Z" }, generatedAt: validPool.handover.safeAt },
    { ...validPool, handover: { ...validPool.handover, safe: true, safeAt: "2026-07-20T00:10:00.001Z" }, generatedAt: "2026-07-20T00:10:00.001Z" },
    { ...validPool, handover: { ...validPool.handover, safe: true, lastMutationAt: "2026-07-20T00:00:00.001Z" }, generatedAt: validPool.handover.safeAt },
  ])("rejects premature, manager-rebound, or forged-fence handover %#", (pool) => {
    // Given: a safe claim with one invalid source fact.
    // When: the complete proof is parsed.
    const result = PoolSchema.safeParse(pool)
    // Then: the claim fails closed.
    expect(result.success).toBe(false)
  })

  it.each(blockingKeys)("rejects safe handover when blocker %s is nonzero", (blockingKey) => {
    // Given: an otherwise complete proof with one remaining blocker.
    const pool = {
      ...validPool,
      handover: { ...validPool.handover, safe: true, blocking: { ...zeroBlocking, [blockingKey]: 1 } },
      generatedAt: validPool.handover.safeAt,
    }
    // When: the pool validates the safe claim.
    const result = PoolSchema.safeParse(pool)
    // Then: every blocker independently prevents handover.
    expect(result.success).toBe(false)
  })

  it.each([
    { ...validPool, counts: { ...validPool.counts, physical: 3 } },
    { ...validPool, counts: { ...validPool.counts, busy: 1 } },
    { ...validPool, mode: MANAGER_MODE.SERVING },
    { ...validPool, memory: { ...validPool.memory, dynamicLimitBytes: 499 } },
    { ...validPool, memory: { ...validPool.memory, managerLimitBytes: 1 } },
  ])("rejects inconsistent pool formula %#", (pool) => {
    // Given: a pool projection with one impossible aggregate.
    // When: the schema validates it.
    const result = PoolSchema.safeParse(pool)
    // Then: the atomic projection is rejected.
    expect(result.success).toBe(false)
  })

  it("rejects a formula-consistent pool above the fixed two-worker topology", () => {
    // Given: a self-consistent projection from a superseded three-worker topology.
    const pool = {
      ...validPool,
      counts: {
        ...validPool.counts,
        physical: 3,
        usableReachable: 3,
        reconciledIdle: 3,
        byState: { ...validPool.counts.byState, idle: 3 },
      },
    }
    // When: the active pool boundary parses it.
    const result = PoolSchema.safeParse(pool)
    // Then: the fixed overlay count rejects it.
    expect(result.success).toBe(false)
  })

  it("rejects unknown fields on the public pool resource", () => {
    // Given: a valid pool with one private additive field.
    const input = { ...validPool, internalOrigin: "http://worker-00:3000" }
    // When: it crosses the strict public boundary.
    const result = PoolSchema.safeParse(input)
    // Then: the undeclared field is rejected.
    expect(result.success).toBe(false)
  })
})
