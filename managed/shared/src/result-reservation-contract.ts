import { z } from "zod"

import { ResultIdSchema, type ResultId } from "./control-plane-primitives.js"

export const RESULT_RESERVATION_STATE = {
  IN_FLIGHT: "IN_FLIGHT",
  PREPARED: "PREPARED",
  RETAINED: "RETAINED",
} as const
export type ResultReservationState = (typeof RESULT_RESERVATION_STATE)[keyof typeof RESULT_RESERVATION_STATE]

export const RESULT_RESERVATION_OUTCOME = {
  RESERVED: "RESERVED",
  DUPLICATE: "DUPLICATE",
  CAPACITY: "CAPACITY",
  TOO_LARGE: "TOO_LARGE",
} as const
export type ResultReservationOutcomeKind = (typeof RESULT_RESERVATION_OUTCOME)[keyof typeof RESULT_RESERVATION_OUTCOME]

export const RESULT_PREPARE_OUTCOME = {
  PREPARED: "PREPARED",
  REJECTED: "REJECTED",
  QUARANTINED: "QUARANTINED",
} as const

export const RESULT_COMMIT_OUTCOME = {
  COMMITTED: "COMMITTED",
  REJECTED: "REJECTED",
  QUARANTINED: "QUARANTINED",
} as const

export const RESULT_COMMIT_REJECTION_REASON = {
  MISSING_RESERVATION: "MISSING_RESERVATION",
  ALREADY_PREPARED: "ALREADY_PREPARED",
  COMPLETION_TIME_INVALID: "COMPLETION_TIME_INVALID",
  LEASE_EXPIRED: "LEASE_EXPIRED",
  OVERSIZE: "OVERSIZE",
  STALE_OR_FORGED_TOKEN: "STALE_OR_FORGED_TOKEN",
} as const
export type ResultCommitRejectionReason =
  (typeof RESULT_COMMIT_REJECTION_REASON)[keyof typeof RESULT_COMMIT_REJECTION_REASON]

export const RESULT_FAILURE_RELEASE_REASON = {
  INVALID_CONTRACT: "INVALID_CONTRACT",
  LIMIT_EXCEEDED: "LIMIT_EXCEEDED",
  RETAINED_COMMIT_ABORTED: "RETAINED_COMMIT_ABORTED",
} as const
export const RESULT_FAILURE_RELEASE_OUTCOME = { RELEASED: "RELEASED", MISSING: "MISSING" } as const

export const RESULT_RESERVATION_AUDIT_REASON = {
  PREPARE_ON_RETAINED: "PREPARE_ON_RETAINED",
  COMMIT_ON_RETAINED: "COMMIT_ON_RETAINED",
  CORRUPT_RETAINED_RECORD: "CORRUPT_RETAINED_RECORD",
} as const
export type ResultReservationAuditReason =
  (typeof RESULT_RESERVATION_AUDIT_REASON)[keyof typeof RESULT_RESERVATION_AUDIT_REASON]

export const RESULT_RETAINED_QUARANTINE_OUTCOME = { QUARANTINED: "QUARANTINED", MISSING: "MISSING" } as const

export const NonnegativeSafeIntegerSchema = z.number().int().nonnegative().safe()
const PositiveSafeIntegerSchema = z.number().int().positive().safe()

export const ResultReservationLimitsSchema = z.object({
  limitBytes: PositiveSafeIntegerSchema,
  limitCount: PositiveSafeIntegerSchema,
  resultTtlMs: PositiveSafeIntegerSchema,
}).strict()

export const ResultReservationInputSchema = z.object({
  resultId: ResultIdSchema,
  reservedBytes: PositiveSafeIntegerSchema,
  nowMs: NonnegativeSafeIntegerSchema,
  inFlightDeadlineMs: NonnegativeSafeIntegerSchema,
}).strict().superRefine((input, context) => {
  if (input.inFlightDeadlineMs <= input.nowMs) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "result reservation lease must be in the future" })
  }
})

export const ResultPrepareInputSchema = z.object({
  resultId: ResultIdSchema,
  byteLength: NonnegativeSafeIntegerSchema,
  completedAtMs: NonnegativeSafeIntegerSchema,
}).strict()

export const ResultFailureReleaseInputSchema = z.object({
  resultId: ResultIdSchema,
  reason: z.enum([
    RESULT_FAILURE_RELEASE_REASON.INVALID_CONTRACT,
    RESULT_FAILURE_RELEASE_REASON.LIMIT_EXCEEDED,
  ]),
}).strict()

export const RetainedQuarantineInputSchema = z.object({
  resultId: ResultIdSchema,
  reason: z.literal(RESULT_RESERVATION_AUDIT_REASON.CORRUPT_RETAINED_RECORD),
}).strict()

const PreparedResultCommitTokenBrand: unique symbol = Symbol("PreparedResultCommitToken")
export type PreparedResultCommitToken = Readonly<{
  readonly resultId: ResultId
  readonly [PreparedResultCommitTokenBrand]: true
}>

export function createPreparedResultCommitToken(resultId: ResultId): PreparedResultCommitToken {
  return Object.freeze({ resultId, [PreparedResultCommitTokenBrand]: true })
}

export type ReservationEntry =
  | Readonly<{ state: typeof RESULT_RESERVATION_STATE.IN_FLIGHT; reservedBytes: number; reservedAtMs: number; inFlightDeadlineMs: number }>
  | Readonly<{ state: typeof RESULT_RESERVATION_STATE.PREPARED; reservedBytes: number; inFlightDeadlineMs: number; expiresAtMs: number; token: PreparedResultCommitToken }>
  | Readonly<{ state: typeof RESULT_RESERVATION_STATE.RETAINED; reservedBytes: number; expiresAtMs: number; committedToken: PreparedResultCommitToken }>

export type ResultCapacityExhaustion =
  | Readonly<{ state: typeof RESULT_RESERVATION_STATE.IN_FLIGHT }>
  | Readonly<{ state: typeof RESULT_RESERVATION_STATE.RETAINED; earliestRetainedExpiresAtMs: number }>

export type ResultReservationOutcome =
  | Readonly<{ outcome: typeof RESULT_RESERVATION_OUTCOME.RESERVED }>
  | Readonly<{ outcome: typeof RESULT_RESERVATION_OUTCOME.DUPLICATE }>
  | Readonly<{ outcome: typeof RESULT_RESERVATION_OUTCOME.TOO_LARGE }>
  | Readonly<{ outcome: typeof RESULT_RESERVATION_OUTCOME.CAPACITY; exhaustion: ResultCapacityExhaustion }>

export type ResultPrepareOutcome =
  | Readonly<{ outcome: typeof RESULT_PREPARE_OUTCOME.PREPARED; resultId: ResultId; token: PreparedResultCommitToken }>
  | Readonly<{ outcome: typeof RESULT_PREPARE_OUTCOME.REJECTED; resultId: ResultId; reason: ResultCommitRejectionReason; released: boolean }>
  | Readonly<{ outcome: typeof RESULT_PREPARE_OUTCOME.QUARANTINED; resultId: ResultId; auditReason: ResultReservationAuditReason; released: true }>

export type ResultReservationSnapshot = Readonly<{
  reservedBytes: number; reservedCount: number; inFlightBytes: number; inFlightCount: number
  retainedBytes: number; retainedCount: number; earliestRetainedExpiresAtMs?: number
}>
