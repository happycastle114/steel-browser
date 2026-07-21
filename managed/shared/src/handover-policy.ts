import { z } from "zod"

import { CONFIGURABLE_NUMERIC_BOUNDS } from "./control-plane-config-values.js"
import { ManagerInstanceIdSchema } from "./control-plane-primitives.js"

const BlockingCountsSchema = z.object({
  queued: z.number().int().nonnegative().safe(),
  reserved: z.number().int().nonnegative().safe(),
  starting: z.number().int().nonnegative().safe(),
  live: z.number().int().nonnegative().safe(),
  releasing: z.number().int().nonnegative().safe(),
  uncertain: z.number().int().nonnegative().safe(),
  httpCreates: z.number().int().nonnegative().safe(),
  webSockets: z.number().int().nonnegative().safe(),
}).strict()

const IdempotencyTtlMsSchema = z.number()
  .int()
  .safe()
  .min(CONFIGURABLE_NUMERIC_BOUNDS.idempotencyTtlMs.minimum)
  .max(CONFIGURABLE_NUMERIC_BOUNDS.idempotencyTtlMs.maximum)

const TimestampMsSchema = z.number().int().nonnegative().safe()

const SafeAtInputSchema = z.object({
  drainEnteredAtMs: TimestampMsSchema,
  lastAcceptedOrTerminalAtMs: TimestampMsSchema,
  idempotencyTtlMs: IdempotencyTtlMsSchema,
}).strict()

const HandoverProofSchema = z.object({
  nowMs: TimestampMsSchema,
  safeAtMs: TimestampMsSchema,
  drainEnteredAtMs: TimestampMsSchema,
  lastAcceptedOrTerminalAtMs: TimestampMsSchema,
  idempotencyTtlMs: IdempotencyTtlMsSchema,
  drainingManagerInstanceId: ManagerInstanceIdSchema,
  currentManagerInstanceId: ManagerInstanceIdSchema,
  blocking: BlockingCountsSchema,
}).strict()

export type BlockingCounts = z.infer<typeof BlockingCountsSchema>
export type HandoverProof = z.infer<typeof HandoverProofSchema>

function deriveDrainSafeAt(input: z.output<typeof SafeAtInputSchema>): number {
  return Math.max(input.drainEnteredAtMs, input.lastAcceptedOrTerminalAtMs) + input.idempotencyTtlMs
}

export function computeDrainSafeAt(input: z.input<typeof SafeAtInputSchema>): number {
  const parsed = SafeAtInputSchema.parse(input)
  return TimestampMsSchema.parse(deriveDrainSafeAt(parsed))
}

export function handoverSafeAtIsExact(proof: HandoverProof): boolean {
  const expectedSafeAtMs = deriveDrainSafeAt({
    drainEnteredAtMs: proof.drainEnteredAtMs,
    lastAcceptedOrTerminalAtMs: proof.lastAcceptedOrTerminalAtMs,
    idempotencyTtlMs: proof.idempotencyTtlMs,
  })
  return Number.isSafeInteger(expectedSafeAtMs) && proof.safeAtMs === expectedSafeAtMs
}

export function handoverIsSafe(proof: HandoverProof): boolean {
  return handoverSafeAtIsExact(proof) &&
    proof.drainingManagerInstanceId === proof.currentManagerInstanceId &&
    proof.nowMs >= proof.safeAtMs &&
    Object.values(proof.blocking).every((count) => count === 0)
}

export { BlockingCountsSchema, HandoverProofSchema, IdempotencyTtlMsSchema }
