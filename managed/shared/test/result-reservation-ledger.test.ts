import { describe, expect, it } from "vitest"

import {
  RESULT_COMMIT_OUTCOME,
  RESULT_COMMIT_REJECTION_REASON,
  RESULT_FAILURE_RELEASE_OUTCOME,
  RESULT_FAILURE_RELEASE_REASON,
  RESULT_PREPARE_OUTCOME,
  RESULT_RETAINED_QUARANTINE_OUTCOME,
  RESULT_RESERVATION_AUDIT_REASON,
  RESULT_RESERVATION_OUTCOME,
  RESULT_RESERVATION_STATE,
  ResultReservationLedger,
  type PreparedResultCommitToken,
  type ResultPrepareOutcome,
} from "../src/result-reservation-ledger.js"

const resultA = "018f56c8-6f7a-4c45-9e5d-77adff18f7ac"
const resultB = "118f56c8-6f7a-4c45-9e5d-77adff18f7ac"

function ledger(limitBytes = 100, limitCount = 2): ResultReservationLedger {
  return new ResultReservationLedger({ limitBytes, limitCount, resultTtlMs: 60_000 })
}

function reserve(subject: ResultReservationLedger, resultId = resultA, reservedBytes = 80): void {
  expect(subject.reserve({
    resultId,
    reservedBytes,
    nowMs: 1_000,
    inFlightDeadlineMs: 121_000,
  }).outcome).toBe(RESULT_RESERVATION_OUTCOME.RESERVED)
}

function tokenFrom(outcome: ResultPrepareOutcome): PreparedResultCommitToken {
  switch (outcome.outcome) {
    case RESULT_PREPARE_OUTCOME.PREPARED:
      return outcome.token
    case RESULT_PREPARE_OUTCOME.REJECTED:
    case RESULT_PREPARE_OUTCOME.QUARANTINED:
      throw new TypeError("test fixture did not prepare a retained commit")
  }
}

describe("two-phase retained AI result reservation ledger", () => {
  it("shrinks an in-flight reservation before retained commit", () => {
    // Given: a validated completion for a larger in-flight reservation.
    const subject = ledger()
    reserve(subject)
    // When: the service prepares exact retained bytes after external validation.
    const prepared = subject.prepareRetainedCommit({ resultId: resultA, byteLength: 30, completedAtMs: 60_000 })
    // Then: the reservation remains non-public and shrinks to exact bytes.
    expect(prepared.outcome).toBe(RESULT_PREPARE_OUTCOME.PREPARED)
    expect(subject.stateOf(resultA)).toBe(RESULT_RESERVATION_STATE.PREPARED)
    expect(subject.snapshot()).toMatchObject({ reservedBytes: 30, inFlightBytes: 30, retainedBytes: 0 })
  })

  it("atomically retains prepared bytes for one full completion-time TTL", () => {
    // Given: an exact-byte prepared commit after a long action.
    const subject = ledger()
    reserve(subject)
    const token = tokenFrom(subject.prepareRetainedCommit({
      resultId: resultA,
      byteLength: 30,
      completedAtMs: 60_000,
    }))
    // When: the service commits the opaque prepared token.
    const outcome = subject.commitRetained(token)
    // Then: only the committed outcome authorizes publication with exact expiry.
    expect(outcome).toEqual({
      outcome: RESULT_COMMIT_OUTCOME.COMMITTED,
      resultId: resultA,
      expiresAtMs: 120_000,
    })
    expect(subject.stateOf(resultA)).toBe(RESULT_RESERVATION_STATE.RETAINED)
  })

  it.each([
    RESULT_FAILURE_RELEASE_REASON.INVALID_CONTRACT,
    RESULT_FAILURE_RELEASE_REASON.LIMIT_EXCEEDED,
  ])("releases %s validation failure exactly once before prepare", (reason) => {
    // Given: an in-flight reservation whose raw completion failed config-bound validation.
    const subject = ledger()
    reserve(subject)
    // When: validation failure release is repeated.
    const first = subject.releaseFailure({
      resultId: resultA,
      reason,
    })
    const repeated = subject.releaseFailure({
      resultId: resultA,
      reason,
    })
    // Then: the first call releases and the second exposes no reservation.
    expect([first.outcome, repeated.outcome, subject.snapshot().reservedCount]).toEqual([
      RESULT_FAILURE_RELEASE_OUTCOME.RELEASED,
      RESULT_FAILURE_RELEASE_OUTCOME.MISSING,
      0,
    ])
  })

  it.each([
    [RESULT_COMMIT_REJECTION_REASON.COMPLETION_TIME_INVALID, 30, 999],
    [RESULT_COMMIT_REJECTION_REASON.LEASE_EXPIRED, 30, 121_000],
    [RESULT_COMMIT_REJECTION_REASON.OVERSIZE, 81, 60_000],
  ])("rejects and releases %s before a token exists", (reason, byteLength, completedAtMs) => {
    // Given: an in-flight reservation and an invalid validated completion claim.
    const subject = ledger()
    reserve(subject)
    // When: retained commit preparation validates reservation-bound facts.
    const outcome = subject.prepareRetainedCommit({ resultId: resultA, byteLength, completedAtMs })
    // Then: rejection deletes the reservation before any publishable token exists.
    expect(outcome).toEqual({
      outcome: RESULT_PREPARE_OUTCOME.REJECTED,
      resultId: resultA,
      reason,
      released: true,
    })
    expect(subject.stateOf(resultA)).toBeUndefined()
  })

  it("releases an aborted prepared commit exactly once", () => {
    // Given: an exact-byte prepared commit that cannot be retained by the service.
    const subject = ledger()
    reserve(subject)
    const token = tokenFrom(subject.prepareRetainedCommit({ resultId: resultA, byteLength: 30, completedAtMs: 60_000 }))
    // When: prepared abort is repeated with the same token.
    const first = subject.abortPrepared({ token, reason: RESULT_FAILURE_RELEASE_REASON.RETAINED_COMMIT_ABORTED })
    const repeated = subject.abortPrepared({ token, reason: RESULT_FAILURE_RELEASE_REASON.RETAINED_COMMIT_ABORTED })
    // Then: the first abort releases and the stale token cannot release again.
    expect([first.outcome, repeated.outcome, subject.snapshot().reservedCount]).toEqual([
      RESULT_FAILURE_RELEASE_OUTCOME.RELEASED,
      RESULT_FAILURE_RELEASE_OUTCOME.MISSING,
      0,
    ])
  })

  it("rejects a token issued by another ledger without touching the prepared reservation", () => {
    // Given: two ledgers prepared the same result ID with distinct opaque tokens.
    const firstLedger = ledger()
    const secondLedger = ledger()
    reserve(firstLedger)
    reserve(secondLedger)
    const foreign = tokenFrom(firstLedger.prepareRetainedCommit({ resultId: resultA, byteLength: 30, completedAtMs: 60_000 }))
    const local = tokenFrom(secondLedger.prepareRetainedCommit({ resultId: resultA, byteLength: 30, completedAtMs: 60_000 }))
    // When: the second ledger receives the foreign token.
    const rejected = secondLedger.commitRetained(foreign)
    // Then: it rejects the forged token and preserves the legitimate prepared commit.
    expect(rejected).toMatchObject({
      outcome: RESULT_COMMIT_OUTCOME.REJECTED,
      reason: RESULT_COMMIT_REJECTION_REASON.STALE_OR_FORGED_TOKEN,
      released: false,
    })
    expect(secondLedger.commitRetained(local).outcome).toBe(RESULT_COMMIT_OUTCOME.COMMITTED)
  })

  it("rejects an aborted stale token without releasing a new reservation", () => {
    // Given: an old prepared token was aborted before the same result ID was reserved again.
    const subject = ledger()
    reserve(subject)
    const stale = tokenFrom(subject.prepareRetainedCommit({ resultId: resultA, byteLength: 30, completedAtMs: 60_000 }))
    subject.abortPrepared({ token: stale, reason: RESULT_FAILURE_RELEASE_REASON.RETAINED_COMMIT_ABORTED })
    reserve(subject)
    // When: the stale token arrives after the new reservation.
    const rejected = subject.commitRetained(stale)
    // Then: stale-token rejection does not delete the unrelated current reservation.
    expect(rejected).toMatchObject({
      outcome: RESULT_COMMIT_OUTCOME.REJECTED,
      reason: RESULT_COMMIT_REJECTION_REASON.STALE_OR_FORGED_TOKEN,
      released: false,
    })
    expect(subject.stateOf(resultA)).toBe(RESULT_RESERVATION_STATE.IN_FLIGHT)
  })

  it("quarantines and deletes an impossible retained recommit", () => {
    // Given: a token already committed its reservation to retained state.
    const subject = ledger()
    reserve(subject)
    const token = tokenFrom(subject.prepareRetainedCommit({ resultId: resultA, byteLength: 30, completedAtMs: 60_000 }))
    subject.commitRetained(token)
    // When: the same token attempts to commit the retained entry again.
    const outcome = subject.commitRetained(token)
    // Then: the invariant breach is audited and the corrupt retained quota is released.
    expect(outcome).toEqual({
      outcome: RESULT_COMMIT_OUTCOME.QUARANTINED,
      resultId: resultA,
      auditReason: RESULT_RESERVATION_AUDIT_REASON.COMMIT_ON_RETAINED,
      released: true,
    })
    expect(subject.snapshot().reservedCount).toBe(0)
  })

  it("quarantines a corrupt retained record exactly once without a commit token", () => {
    // Given: lookup discovered corruption after a result was retained.
    const subject = ledger()
    reserve(subject)
    const token = tokenFrom(subject.prepareRetainedCommit({ resultId: resultA, byteLength: 30, completedAtMs: 60_000 }))
    subject.commitRetained(token)
    // When: explicit retained quarantine is repeated for the corrupt record.
    const first = subject.quarantineRetained({
      resultId: resultA,
      reason: RESULT_RESERVATION_AUDIT_REASON.CORRUPT_RETAINED_RECORD,
    })
    const repeated = subject.quarantineRetained({
      resultId: resultA,
      reason: RESULT_RESERVATION_AUDIT_REASON.CORRUPT_RETAINED_RECORD,
    })
    // Then: only the first quarantine releases quota and carries the audit reason.
    expect([first.outcome, first.released, first.auditReason, repeated.outcome, repeated.released]).toEqual([
      RESULT_RETAINED_QUARANTINE_OUTCOME.QUARANTINED,
      true,
      RESULT_RESERVATION_AUDIT_REASON.CORRUPT_RETAINED_RECORD,
      RESULT_RETAINED_QUARANTINE_OUTCOME.MISSING,
      false,
    ])
    expect(subject.snapshot().reservedCount).toBe(0)
  })

  it("reports completion-derived retained expiry for capacity retry", () => {
    // Given: a committed result fills retained-only capacity.
    const subject = ledger(30, 1)
    reserve(subject, resultA, 30)
    const token = tokenFrom(subject.prepareRetainedCommit({ resultId: resultA, byteLength: 30, completedAtMs: 60_000 }))
    subject.commitRetained(token)
    // When: another result asks for capacity before retained expiry.
    const outcome = subject.reserve({ resultId: resultB, reservedBytes: 1, nowMs: 61_000, inFlightDeadlineMs: 122_000 })
    // Then: retry metadata names the completion-derived expiry.
    expect(outcome).toEqual({
      outcome: RESULT_RESERVATION_OUTCOME.CAPACITY,
      exhaustion: { state: RESULT_RESERVATION_STATE.RETAINED, earliestRetainedExpiresAtMs: 120_000 },
    })
  })
})
