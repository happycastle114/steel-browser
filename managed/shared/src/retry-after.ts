import { z } from "zod"

import { MANAGED_ERROR_CODE, ManagedErrorCodeSchema, type ManagedErrorCode } from "./error-contract.js"
import { RetryAfterHeaderValueSchema, RetryAfterSecondsSchema } from "./http-response-contract.js"

export { RetryAfterHeaderValueSchema, RetryAfterSecondsSchema } from "./http-response-contract.js"

export const RETRY_AFTER_REASON = {
  RECONCILE: "RECONCILE",
  FIXED_CAPACITY: "FIXED_CAPACITY",
  SNAPSHOT_CAPACITY: "SNAPSHOT_CAPACITY",
  WINDOW_RESET: "WINDOW_RESET",
} as const
export type RetryAfterReason = (typeof RETRY_AFTER_REASON)[keyof typeof RETRY_AFTER_REASON]

export const RETRY_POLICY_CAUSE = {
  TOKEN_BUCKET: "TOKEN_BUCKET",
  QUEUE_FULL: "QUEUE_FULL",
  TICKET_CAPACITY: "TICKET_CAPACITY",
  SYNC_NONTERMINAL_TIMEOUT: "SYNC_NONTERMINAL_TIMEOUT",
  NO_REACHABLE_WORKER: "NO_REACHABLE_WORKER",
  INGRESS_CAPACITY: "INGRESS_CAPACITY",
  ACTION_CAPACITY: "ACTION_CAPACITY",
  WEBSOCKET_CAPACITY: "WEBSOCKET_CAPACITY",
  AI_RESULT_CAPACITY: "AI_RESULT_CAPACITY",
  EXPIRED_TERMINAL: "EXPIRED_TERMINAL",
  SUBJECT_CAPACITY: "SUBJECT_CAPACITY",
  IDEMPOTENCY_CAPACITY: "IDEMPOTENCY_CAPACITY",
  MANAGER_DRAINING: "MANAGER_DRAINING",
  SNAPSHOT_CAPACITY: "SNAPSHOT_CAPACITY",
} as const
export type RetryPolicyCause = (typeof RETRY_POLICY_CAUSE)[keyof typeof RETRY_POLICY_CAUSE]

export const AI_RESULT_CAPACITY_STATE = {
  IN_FLIGHT_CONTRIBUTES: "IN_FLIGHT_CONTRIBUTES",
  RETAINED_ONLY: "RETAINED_ONLY",
} as const

const ReconcileRetrySchema = z.object({ reason: z.literal(RETRY_AFTER_REASON.RECONCILE), reconcileMs: z.number().int().positive().safe() }).strict()
const FixedCapacityRetrySchema = z.object({ reason: z.literal(RETRY_AFTER_REASON.FIXED_CAPACITY) }).strict()
const SnapshotRetrySchema = z.object({ reason: z.literal(RETRY_AFTER_REASON.SNAPSHOT_CAPACITY) }).strict()
const WindowRetrySchema = z.object({
  reason: z.literal(RETRY_AFTER_REASON.WINDOW_RESET),
  nowMs: z.number().int().nonnegative().safe(),
  expiresAtMs: z.number().int().nonnegative().safe(),
}).strict()
const RetryAfterInputSchema = z.discriminatedUnion("reason", [ReconcileRetrySchema, FixedCapacityRetrySchema, SnapshotRetrySchema, WindowRetrySchema])

const ReconcilePolicySchema = z.object({
  cause: z.union([
    z.literal(RETRY_POLICY_CAUSE.QUEUE_FULL),
    z.literal(RETRY_POLICY_CAUSE.TICKET_CAPACITY),
    z.literal(RETRY_POLICY_CAUSE.SYNC_NONTERMINAL_TIMEOUT),
    z.literal(RETRY_POLICY_CAUSE.NO_REACHABLE_WORKER),
    z.literal(RETRY_POLICY_CAUSE.INGRESS_CAPACITY),
    z.literal(RETRY_POLICY_CAUSE.ACTION_CAPACITY),
    z.literal(RETRY_POLICY_CAUSE.WEBSOCKET_CAPACITY),
  ]),
  reconcileMs: z.number().int().positive().safe(),
}).strict()
const TokenBucketPolicySchema = z.object({
  cause: z.literal(RETRY_POLICY_CAUSE.TOKEN_BUCKET),
  nowMs: z.number().int().nonnegative().safe(),
  resetAtMs: z.number().int().nonnegative().safe(),
}).strict()
const ExpiredTerminalPolicySchema = z.object({
  cause: z.literal(RETRY_POLICY_CAUSE.EXPIRED_TERMINAL),
  nowMs: z.number().int().nonnegative().safe(),
  expiresAtMs: z.number().int().nonnegative().safe(),
}).strict()
const FixedPolicySchema = z.object({
  cause: z.union([
    z.literal(RETRY_POLICY_CAUSE.SUBJECT_CAPACITY),
    z.literal(RETRY_POLICY_CAUSE.IDEMPOTENCY_CAPACITY),
    z.literal(RETRY_POLICY_CAUSE.MANAGER_DRAINING),
  ]),
}).strict()
const SnapshotPolicySchema = z.object({ cause: z.literal(RETRY_POLICY_CAUSE.SNAPSHOT_CAPACITY) }).strict()
const InFlightResultPolicySchema = z.object({
  cause: z.literal(RETRY_POLICY_CAUSE.AI_RESULT_CAPACITY),
  state: z.literal(AI_RESULT_CAPACITY_STATE.IN_FLIGHT_CONTRIBUTES),
  reconcileMs: z.number().int().positive().safe(),
}).strict()
const RetainedResultPolicySchema = z.object({
  cause: z.literal(RETRY_POLICY_CAUSE.AI_RESULT_CAPACITY),
  state: z.literal(AI_RESULT_CAPACITY_STATE.RETAINED_ONLY),
  nowMs: z.number().int().nonnegative().safe(),
  earliestRetainedExpiresAtMs: z.number().int().nonnegative().safe(),
}).strict()
const RetryPolicyInputSchema = z.union([
  ReconcilePolicySchema,
  TokenBucketPolicySchema,
  ExpiredTerminalPolicySchema,
  FixedPolicySchema,
  SnapshotPolicySchema,
  InFlightResultPolicySchema,
  RetainedResultPolicySchema])

export const RetryMetadataSchema = z.object({
  errorCode: ManagedErrorCodeSchema,
  retryAfterSeconds: RetryAfterSecondsSchema,
  headers: z.object({ "Retry-After": RetryAfterHeaderValueSchema }).strict(),
  details: z.object({ retryAfterSeconds: RetryAfterSecondsSchema }).strict(),
}).strict().superRefine((metadata, context) => {
  if (
    metadata.headers["Retry-After"] !== String(metadata.retryAfterSeconds) ||
    metadata.details.retryAfterSeconds !== metadata.retryAfterSeconds
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Retry-After header and error details must match" })
  }
})
export type RetryMetadata = z.infer<typeof RetryMetadataSchema>

export function retryAfterSeconds(input: z.input<typeof RetryAfterInputSchema>): number {
  const parsed = RetryAfterInputSchema.parse(input)
  switch (parsed.reason) {
    case RETRY_AFTER_REASON.RECONCILE:
      return reconcileSeconds(parsed.reconcileMs)
    case RETRY_AFTER_REASON.FIXED_CAPACITY:
      return 60
    case RETRY_AFTER_REASON.SNAPSHOT_CAPACITY:
      return 1
    case RETRY_AFTER_REASON.WINDOW_RESET:
      return windowSeconds(parsed.nowMs, parsed.expiresAtMs)
  }
}

function reconcileSeconds(reconcileMs: number): number {
  return Math.max(1, Math.ceil(reconcileMs / 1_000))
}

function windowSeconds(nowMs: number, expiresAtMs: number): number {
  return Math.max(1, Math.ceil((expiresAtMs - nowMs) / 1_000))
}

function errorCodeFor(cause: RetryPolicyCause): ManagedErrorCode {
  switch (cause) {
    case RETRY_POLICY_CAUSE.TOKEN_BUCKET:
      return MANAGED_ERROR_CODE.RATE_LIMITED
    case RETRY_POLICY_CAUSE.QUEUE_FULL:
      return MANAGED_ERROR_CODE.QUEUE_FULL
    case RETRY_POLICY_CAUSE.TICKET_CAPACITY:
      return MANAGED_ERROR_CODE.MANAGED_TICKET_CAPACITY
    case RETRY_POLICY_CAUSE.SYNC_NONTERMINAL_TIMEOUT:
    case RETRY_POLICY_CAUSE.EXPIRED_TERMINAL:
      return MANAGED_ERROR_CODE.ADMISSION_TIMEOUT
    case RETRY_POLICY_CAUSE.NO_REACHABLE_WORKER:
      return MANAGED_ERROR_CODE.NO_REACHABLE_WORKER
    case RETRY_POLICY_CAUSE.INGRESS_CAPACITY:
      return MANAGED_ERROR_CODE.MANAGED_INGRESS_CAPACITY
    case RETRY_POLICY_CAUSE.ACTION_CAPACITY:
      return MANAGED_ERROR_CODE.MANAGED_ACTION_CAPACITY
    case RETRY_POLICY_CAUSE.WEBSOCKET_CAPACITY:
      return MANAGED_ERROR_CODE.MANAGED_WS_CAPACITY
    case RETRY_POLICY_CAUSE.AI_RESULT_CAPACITY:
      return MANAGED_ERROR_CODE.MANAGED_AI_RESULT_CAPACITY
    case RETRY_POLICY_CAUSE.SUBJECT_CAPACITY:
      return MANAGED_ERROR_CODE.MANAGED_LIMITER_CAPACITY
    case RETRY_POLICY_CAUSE.IDEMPOTENCY_CAPACITY:
      return MANAGED_ERROR_CODE.MANAGED_IDEMPOTENCY_CAPACITY
    case RETRY_POLICY_CAUSE.MANAGER_DRAINING:
      return MANAGED_ERROR_CODE.MANAGER_DRAINING
    case RETRY_POLICY_CAUSE.SNAPSHOT_CAPACITY:
      return MANAGED_ERROR_CODE.MANAGED_SNAPSHOT_CAPACITY
  }
}

export function retryMetadataFor(input: z.input<typeof RetryPolicyInputSchema>): RetryMetadata {
  const policy = RetryPolicyInputSchema.parse(input)
  let seconds: number
  switch (policy.cause) {
    case RETRY_POLICY_CAUSE.TOKEN_BUCKET:
      seconds = windowSeconds(policy.nowMs, policy.resetAtMs)
      break
    case RETRY_POLICY_CAUSE.QUEUE_FULL:
    case RETRY_POLICY_CAUSE.TICKET_CAPACITY:
    case RETRY_POLICY_CAUSE.SYNC_NONTERMINAL_TIMEOUT:
    case RETRY_POLICY_CAUSE.NO_REACHABLE_WORKER:
    case RETRY_POLICY_CAUSE.INGRESS_CAPACITY:
    case RETRY_POLICY_CAUSE.ACTION_CAPACITY:
    case RETRY_POLICY_CAUSE.WEBSOCKET_CAPACITY:
      seconds = reconcileSeconds(policy.reconcileMs)
      break
    case RETRY_POLICY_CAUSE.AI_RESULT_CAPACITY:
      switch (policy.state) {
        case AI_RESULT_CAPACITY_STATE.IN_FLIGHT_CONTRIBUTES:
          seconds = reconcileSeconds(policy.reconcileMs)
          break
        case AI_RESULT_CAPACITY_STATE.RETAINED_ONLY:
          seconds = windowSeconds(policy.nowMs, policy.earliestRetainedExpiresAtMs)
          break
      }
      break
    case RETRY_POLICY_CAUSE.EXPIRED_TERMINAL:
      seconds = windowSeconds(policy.nowMs, policy.expiresAtMs)
      break
    case RETRY_POLICY_CAUSE.SUBJECT_CAPACITY:
    case RETRY_POLICY_CAUSE.IDEMPOTENCY_CAPACITY:
    case RETRY_POLICY_CAUSE.MANAGER_DRAINING:
      seconds = 60
      break
    case RETRY_POLICY_CAUSE.SNAPSHOT_CAPACITY:
      seconds = 1
      break
  }
  return RetryMetadataSchema.parse({
    errorCode: errorCodeFor(policy.cause),
    retryAfterSeconds: seconds,
    headers: { "Retry-After": String(seconds) },
    details: { retryAfterSeconds: seconds },
  })
}
