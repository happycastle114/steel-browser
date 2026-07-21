import { z } from "zod"

import { type ResultId } from "./control-plane-primitives.js"
import {
  NonnegativeSafeIntegerSchema,
  RESULT_COMMIT_OUTCOME,
  RESULT_COMMIT_REJECTION_REASON,
  RESULT_FAILURE_RELEASE_OUTCOME,
  RESULT_FAILURE_RELEASE_REASON,
  RESULT_PREPARE_OUTCOME,
  RESULT_RESERVATION_AUDIT_REASON,
  RESULT_RESERVATION_OUTCOME,
  RESULT_RESERVATION_STATE,
  RESULT_RETAINED_QUARANTINE_OUTCOME,
  ResultFailureReleaseInputSchema,
  ResultPrepareInputSchema,
  ResultReservationInputSchema,
  ResultReservationLimitsSchema,
  RetainedQuarantineInputSchema,
  createPreparedResultCommitToken,
  type PreparedResultCommitToken,
  type ReservationEntry,
  type ResultCommitRejectionReason,
  type ResultPrepareOutcome,
  type ResultReservationOutcome,
  type ResultReservationSnapshot,
  type ResultReservationState,
} from "./result-reservation-contract.js"
import {
  projectResultReservationSnapshot,
  resultCapacityExhaustion,
} from "./result-reservation-projection.js"

export * from "./result-reservation-contract.js"

type AbortPreparedInput = Readonly<{
  token: PreparedResultCommitToken
  reason: typeof RESULT_FAILURE_RELEASE_REASON.RETAINED_COMMIT_ABORTED
}>

export class ResultReservationLedger {
  readonly #limitBytes: number
  readonly #limitCount: number
  readonly #resultTtlMs: number
  readonly #entries = new Map<ResultId, ReservationEntry>()
  readonly #tokenResultIds = new WeakMap<PreparedResultCommitToken, ResultId>()

  public constructor(input: z.input<typeof ResultReservationLimitsSchema>) {
    const limits = ResultReservationLimitsSchema.parse(input)
    this.#limitBytes = limits.limitBytes
    this.#limitCount = limits.limitCount
    this.#resultTtlMs = limits.resultTtlMs
  }

  public reserve(input: z.input<typeof ResultReservationInputSchema>): ResultReservationOutcome {
    const reservation = ResultReservationInputSchema.parse(input)
    this.#expire(reservation.nowMs)
    if (this.#entries.has(reservation.resultId)) return { outcome: RESULT_RESERVATION_OUTCOME.DUPLICATE }
    if (reservation.reservedBytes > this.#limitBytes) return { outcome: RESULT_RESERVATION_OUTCOME.TOO_LARGE }
    const snapshot = this.snapshot()
    if (
      snapshot.reservedCount + 1 > this.#limitCount ||
      snapshot.reservedBytes + reservation.reservedBytes > this.#limitBytes
    ) {
      return {
        outcome: RESULT_RESERVATION_OUTCOME.CAPACITY,
        exhaustion: resultCapacityExhaustion(snapshot),
      }
    }
    this.#entries.set(reservation.resultId, {
      state: RESULT_RESERVATION_STATE.IN_FLIGHT,
      reservedBytes: reservation.reservedBytes,
      reservedAtMs: reservation.nowMs,
      inFlightDeadlineMs: reservation.inFlightDeadlineMs,
    })
    return { outcome: RESULT_RESERVATION_OUTCOME.RESERVED }
  }

  public prepareRetainedCommit(input: z.input<typeof ResultPrepareInputSchema>): ResultPrepareOutcome {
    const completion = ResultPrepareInputSchema.parse(input)
    const entry = this.#entries.get(completion.resultId)
    if (entry === undefined) return this.#rejected(completion.resultId, RESULT_COMMIT_REJECTION_REASON.MISSING_RESERVATION, false)
    switch (entry.state) {
      case RESULT_RESERVATION_STATE.RETAINED:
        this.#entries.delete(completion.resultId)
        return {
          outcome: RESULT_PREPARE_OUTCOME.QUARANTINED,
          resultId: completion.resultId,
          auditReason: RESULT_RESERVATION_AUDIT_REASON.PREPARE_ON_RETAINED,
          released: true,
        }
      case RESULT_RESERVATION_STATE.PREPARED:
        return this.#rejected(completion.resultId, RESULT_COMMIT_REJECTION_REASON.ALREADY_PREPARED, false)
      case RESULT_RESERVATION_STATE.IN_FLIGHT:
        if (completion.completedAtMs < entry.reservedAtMs) {
          return this.#rejectAndRelease(completion.resultId, RESULT_COMMIT_REJECTION_REASON.COMPLETION_TIME_INVALID)
        }
        if (completion.completedAtMs >= entry.inFlightDeadlineMs) {
          return this.#rejectAndRelease(completion.resultId, RESULT_COMMIT_REJECTION_REASON.LEASE_EXPIRED)
        }
        if (completion.byteLength > entry.reservedBytes) {
          return this.#rejectAndRelease(completion.resultId, RESULT_COMMIT_REJECTION_REASON.OVERSIZE)
        }
        return this.#prepare(completion.resultId, completion.byteLength, completion.completedAtMs, entry.inFlightDeadlineMs)
    }
  }

  public commitRetained(token: PreparedResultCommitToken) {
    const resultId = this.#tokenResultIds.get(token)
    if (resultId === undefined) return this.#commitRejected()
    const entry = this.#entries.get(resultId)
    if (entry?.state === RESULT_RESERVATION_STATE.RETAINED && entry.committedToken === token) {
      this.#entries.delete(resultId)
      return {
        outcome: RESULT_COMMIT_OUTCOME.QUARANTINED,
        resultId,
        auditReason: RESULT_RESERVATION_AUDIT_REASON.COMMIT_ON_RETAINED,
        released: true,
      } as const
    }
    if (entry?.state !== RESULT_RESERVATION_STATE.PREPARED || entry.token !== token) return this.#commitRejected()
    this.#entries.set(resultId, {
      state: RESULT_RESERVATION_STATE.RETAINED,
      reservedBytes: entry.reservedBytes,
      expiresAtMs: entry.expiresAtMs,
      committedToken: token,
    })
    return { outcome: RESULT_COMMIT_OUTCOME.COMMITTED, resultId, expiresAtMs: entry.expiresAtMs } as const
  }

  public releaseFailure(input: unknown) {
    const failure = ResultFailureReleaseInputSchema.parse(input)
    const entry = this.#entries.get(failure.resultId)
    if (entry?.state !== RESULT_RESERVATION_STATE.IN_FLIGHT) {
      return { outcome: RESULT_FAILURE_RELEASE_OUTCOME.MISSING, resultId: failure.resultId, released: false } as const
    }
    this.#entries.delete(failure.resultId)
    return { outcome: RESULT_FAILURE_RELEASE_OUTCOME.RELEASED, resultId: failure.resultId, reason: failure.reason, released: true } as const
  }

  public abortPrepared(input: AbortPreparedInput) {
    const resultId = this.#tokenResultIds.get(input.token)
    const entry = resultId === undefined ? undefined : this.#entries.get(resultId)
    if (resultId === undefined || entry?.state !== RESULT_RESERVATION_STATE.PREPARED || entry.token !== input.token) {
      return { outcome: RESULT_FAILURE_RELEASE_OUTCOME.MISSING, released: false } as const
    }
    this.#entries.delete(resultId)
    return { outcome: RESULT_FAILURE_RELEASE_OUTCOME.RELEASED, resultId, reason: input.reason, released: true } as const
  }

  public quarantineRetained(input: unknown) {
    const quarantine = RetainedQuarantineInputSchema.parse(input)
    const entry = this.#entries.get(quarantine.resultId)
    if (entry?.state !== RESULT_RESERVATION_STATE.RETAINED) {
      return { outcome: RESULT_RETAINED_QUARANTINE_OUTCOME.MISSING, released: false } as const
    }
    this.#entries.delete(quarantine.resultId)
    return {
      outcome: RESULT_RETAINED_QUARANTINE_OUTCOME.QUARANTINED,
      resultId: quarantine.resultId,
      auditReason: quarantine.reason,
      released: true,
    } as const
  }

  public expire(nowMsInput: unknown): number {
    return this.#expire(NonnegativeSafeIntegerSchema.parse(nowMsInput))
  }

  public stateOf(resultIdInput: unknown): ResultReservationState | undefined {
    return this.#entries.get(ResultPrepareInputSchema.shape.resultId.parse(resultIdInput))?.state
  }

  public snapshot(): ResultReservationSnapshot {
    return projectResultReservationSnapshot(this.#entries.values())
  }

  #prepare(resultId: ResultId, byteLength: number, completedAtMs: number, inFlightDeadlineMs: number): ResultPrepareOutcome {
    const token = createPreparedResultCommitToken(resultId)
    const expiresAtMs = NonnegativeSafeIntegerSchema.parse(completedAtMs + this.#resultTtlMs)
    this.#tokenResultIds.set(token, resultId)
    this.#entries.set(resultId, { state: RESULT_RESERVATION_STATE.PREPARED, reservedBytes: byteLength, inFlightDeadlineMs, expiresAtMs, token })
    return { outcome: RESULT_PREPARE_OUTCOME.PREPARED, resultId, token }
  }

  #rejectAndRelease(resultId: ResultId, reason: ResultCommitRejectionReason): ResultPrepareOutcome {
    this.#entries.delete(resultId)
    return this.#rejected(resultId, reason, true)
  }

  #rejected(resultId: ResultId, reason: ResultCommitRejectionReason, released: boolean): ResultPrepareOutcome {
    return { outcome: RESULT_PREPARE_OUTCOME.REJECTED, resultId, reason, released }
  }

  #commitRejected() {
    return { outcome: RESULT_COMMIT_OUTCOME.REJECTED, reason: RESULT_COMMIT_REJECTION_REASON.STALE_OR_FORGED_TOKEN, released: false } as const
  }

  #expire(nowMs: number): number {
    let released = 0
    for (const [resultId, entry] of this.#entries) {
      const deadlineMs = entry.state === RESULT_RESERVATION_STATE.RETAINED ? entry.expiresAtMs : entry.inFlightDeadlineMs
      if (deadlineMs <= nowMs && this.#entries.delete(resultId)) released += 1
    }
    return released
  }
}
