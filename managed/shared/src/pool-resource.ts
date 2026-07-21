import { z } from "zod"

import { ControlPlaneApiVersionSchema } from "./control-plane-contract.js"
import {
  ByteCountSchema,
  IsoTimeSchema,
  ManagerInstanceIdSchema,
  MillisecondCountSchema,
  PoolIdSchema,
  SafeCountSchema,
} from "./control-plane-primitives.js"
import { HANDOVER_MODE, MANAGER_MODE } from "./control-plane-vocabulary.js"
import { ManagerModeCauseSchema, ManagerModeSchema } from "./control-plane-vocabulary-schemas.js"
import {
  BlockingCountsSchema,
  HandoverProofSchema,
  IdempotencyTtlMsSchema,
  handoverIsSafe,
  handoverSafeAtIsExact,
} from "./handover-policy.js"
import { withDeepFrozenOutput } from "./deep-readonly.js"
import type { ControlPlaneConfig } from "./control-plane-config.js"
import { CONTROL_PLANE_DEFAULTS, CONTROL_PLANE_FIXED } from "./control-plane-config-values.js"

export const MemoryLedgerSchema = z.object({
  reservedBytes: ByteCountSchema,
  limitBytes: ByteCountSchema,
  reservedCount: SafeCountSchema,
  limitCount: SafeCountSchema,
}).strict().superRefine((ledger, context) => {
  if (ledger.reservedBytes > ledger.limitBytes) context.addIssue({ code: z.ZodIssueCode.custom, message: "reserved bytes exceed ledger limit" })
  if (ledger.reservedCount > ledger.limitCount) context.addIssue({ code: z.ZodIssueCode.custom, message: "reserved count exceeds ledger limit" })
})

const ServingHandoverSchema = z.object({
  mode: z.literal(HANDOVER_MODE.SERVING),
  safe: z.literal(false),
  blocking: BlockingCountsSchema,
}).strict()
const DrainingHandoverSchema = z.object({
  mode: z.literal(HANDOVER_MODE.DRAINING),
  safe: z.boolean(),
  managerInstanceId: ManagerInstanceIdSchema,
  cause: ManagerModeCauseSchema,
  drainEnteredAt: IsoTimeSchema,
  lastMutationAt: IsoTimeSchema,
  idempotencyTtlMs: IdempotencyTtlMsSchema,
  safeAt: IsoTimeSchema,
  blocking: BlockingCountsSchema,
}).strict()
export const HandoverStateSchema = z.union([ServingHandoverSchema, DrainingHandoverSchema])

export const WorkerStateCountsSchema = z.object({
  discovered: SafeCountSchema,
  reachable: SafeCountSchema,
  idle: SafeCountSchema,
  reserved: SafeCountSchema,
  starting: SafeCountSchema,
  live: SafeCountSchema,
  releasing: SafeCountSchema,
  unreachable: SafeCountSchema,
  quarantined: SafeCountSchema,
  draining: SafeCountSchema,
}).strict()

const PoolBaseSchema = z.object({
  apiVersion: ControlPlaneApiVersionSchema,
  poolId: PoolIdSchema,
  managerInstanceId: ManagerInstanceIdSchema,
  mode: ManagerModeSchema,
  handover: HandoverStateSchema,
  counts: z.object({
    physical: z.literal(CONTROL_PLANE_FIXED.activeWorkerCount),
    usableReachable: SafeCountSchema,
    reconciledIdle: SafeCountSchema,
    busy: SafeCountSchema,
    unavailable: SafeCountSchema,
    byState: WorkerStateCountsSchema,
  }).strict(),
  queue: z.object({ depth: SafeCountSchema, max: SafeCountSchema, oldestWaitMs: MillisecondCountSchema }).strict(),
  memory: z.object({
    managerLimitBytes: ByteCountSchema,
    baseP95Bytes: ByteCountSchema,
    tmpfsLimitBytes: ByteCountSchema,
    snapshotLimitBytes: ByteCountSchema,
    dynamicLimitBytes: ByteCountSchema,
    result: MemoryLedgerSchema,
    action: MemoryLedgerSchema,
    webSocket: MemoryLedgerSchema,
    ingressConnection: MemoryLedgerSchema,
    ingressBody: MemoryLedgerSchema,
  }).strict(),
  generatedAt: IsoTimeSchema,
}).strict()

function validatePool(
  pool: z.output<typeof PoolBaseSchema>,
  bindings: PoolBindings,
  context: z.RefinementCtx,
): void {
  const state = pool.counts.byState
  const physical = Object.values(state).reduce((sum, count) => sum + count, 0)
  const usableReachable = state.reachable + state.idle + state.reserved + state.starting + state.live + state.releasing
  const busy = state.reserved + state.starting + state.live + state.releasing
  const unavailable = state.discovered + state.unreachable + state.quarantined + state.draining
  if (pool.counts.physical !== physical) context.addIssue({ code: z.ZodIssueCode.custom, message: "physical count formula mismatch" })
  if (pool.counts.usableReachable !== usableReachable) context.addIssue({ code: z.ZodIssueCode.custom, message: "usable reachable count formula mismatch" })
  if (pool.counts.reconciledIdle !== state.idle) context.addIssue({ code: z.ZodIssueCode.custom, message: "idle count formula mismatch" })
  if (pool.counts.busy !== busy) context.addIssue({ code: z.ZodIssueCode.custom, message: "busy count formula mismatch" })
  if (pool.counts.unavailable !== unavailable || physical !== usableReachable + unavailable) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "unavailable count formula mismatch" })
  }
  if (pool.mode !== pool.handover.mode) context.addIssue({ code: z.ZodIssueCode.custom, message: "pool and handover mode mismatch" })
  if (pool.handover.mode === HANDOVER_MODE.DRAINING) {
    if (pool.handover.idempotencyTtlMs !== bindings.idempotencyTtlMs) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "handover TTL differs from effective configuration" })
    }
    const proof = {
      nowMs: Date.parse(pool.generatedAt),
      safeAtMs: Date.parse(pool.handover.safeAt),
      drainEnteredAtMs: Date.parse(pool.handover.drainEnteredAt),
      lastAcceptedOrTerminalAtMs: Date.parse(pool.handover.lastMutationAt),
      idempotencyTtlMs: bindings.idempotencyTtlMs,
      drainingManagerInstanceId: pool.handover.managerInstanceId,
      currentManagerInstanceId: pool.managerInstanceId,
      blocking: pool.handover.blocking,
    }
    const parsedProof = HandoverProofSchema.safeParse(proof)
    if (!parsedProof.success || !handoverSafeAtIsExact(parsedProof.data)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "handover safeAt formula mismatch" })
    }
    if (pool.handover.safe && (!parsedProof.success || !handoverIsSafe(parsedProof.data))) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "safe handover proof is incomplete" })
    }
  }
  if (bindings.config !== undefined) {
    if (pool.poolId !== bindings.config.poolId) context.addIssue({ code: z.ZodIssueCode.custom, message: "pool id differs from effective configuration" })
    if (pool.queue.max !== bindings.config.queueMax) context.addIssue({ code: z.ZodIssueCode.custom, message: "queue max differs from effective configuration" })
    const memoryFacts = [
      [pool.memory.managerLimitBytes, bindings.config.memory.managerLimitBytes],
      [pool.memory.baseP95Bytes, bindings.config.managerBaseP95Bytes],
      [pool.memory.tmpfsLimitBytes, CONTROL_PLANE_FIXED.managerTmpfsLimitBytes],
      [pool.memory.snapshotLimitBytes, CONTROL_PLANE_FIXED.listSnapshotBytes],
      [pool.memory.dynamicLimitBytes, bindings.config.memory.dynamicLimitBytes],
      [pool.memory.result.limitBytes, bindings.config.memory.resultBudgetBytes],
      [pool.memory.result.limitCount, bindings.config.memory.resultCountLimit],
      [pool.memory.action.limitBytes, bindings.config.memory.actionBudgetBytes],
      [pool.memory.action.limitCount, bindings.config.memory.actionMax],
      [pool.memory.webSocket.limitBytes, bindings.config.memory.webSocketBudgetBytes],
      [pool.memory.webSocket.limitCount, bindings.config.memory.webSocketMax],
      [pool.memory.ingressConnection.limitBytes, bindings.config.memory.ingressConnectionBudgetBytes],
      [pool.memory.ingressConnection.limitCount, bindings.config.memory.ingressConnectionMax],
      [pool.memory.ingressBody.limitBytes, bindings.config.memory.ingressBodyBudgetBytes],
      [pool.memory.ingressBody.limitCount, bindings.config.memory.ingressBodyMax],
    ] as const
    if (memoryFacts.some(([actual, expected]) => actual !== expected)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "pool memory differs from effective configuration" })
    }
  }
  const ledgers = [pool.memory.result, pool.memory.action, pool.memory.webSocket, pool.memory.ingressConnection, pool.memory.ingressBody]
  const dynamicLimit = ledgers.reduce((sum, ledger) => sum + ledger.limitBytes, 0)
  if (dynamicLimit !== pool.memory.dynamicLimitBytes) context.addIssue({ code: z.ZodIssueCode.custom, message: "dynamic ledger limits do not partition budget" })
  const startup = pool.memory.baseP95Bytes + pool.memory.tmpfsLimitBytes + pool.memory.snapshotLimitBytes + pool.memory.dynamicLimitBytes
  if (startup > Math.floor(CONTROL_PLANE_FIXED.capacityUtilizationRatio * pool.memory.managerLimitBytes)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "manager memory invariant exceeded" })
  }
  if (pool.mode === MANAGER_MODE.SERVING && pool.handover.safe) context.addIssue({ code: z.ZodIssueCode.custom, message: "serving pool cannot claim handover safe" })
}

type PoolBindings = Readonly<{
  idempotencyTtlMs: z.output<typeof IdempotencyTtlMsSchema>
  config?: ControlPlaneConfig
}>

function poolSchemaForIdempotencyTtl(idempotencyTtlMs: number) {
  const configuredIdempotencyTtlMs = IdempotencyTtlMsSchema.parse(idempotencyTtlMs)
  return withDeepFrozenOutput(PoolBaseSchema.superRefine((pool, context) => {
    validatePool(pool, { idempotencyTtlMs: configuredIdempotencyTtlMs }, context)
  }))
}

export function poolSchemaForConfig(config: ControlPlaneConfig) {
  const configuredIdempotencyTtlMs = IdempotencyTtlMsSchema.parse(config.idempotencyTtlMs)
  return withDeepFrozenOutput(PoolBaseSchema.superRefine((pool, context) => {
    validatePool(pool, { idempotencyTtlMs: configuredIdempotencyTtlMs, config }, context)
  }))
}

export const PoolSchema = poolSchemaForIdempotencyTtl(CONTROL_PLANE_DEFAULTS.idempotencyTtlMs)
export type Pool = z.infer<typeof PoolSchema>
export type MemoryLedger = z.infer<typeof MemoryLedgerSchema>
