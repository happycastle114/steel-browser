import {
  RESULT_COMMIT_OUTCOME,
  RESULT_FAILURE_RELEASE_REASON,
  RESULT_PREPARE_OUTCOME,
  RESULT_RESERVATION_OUTCOME,
  RESULT_RESERVATION_STATE,
  ResultReservationLedger,
  canonicalJson,
  type PrincipalId,
  type ResultId,
  type SelectedPublicOrigin,
} from "@happycastle/steel-managed-shared"

import { AI_AUDIT_REASON, type AiAuditSink } from "./execution-contract.js"
import {
  TERMINAL_ACTION_ERROR_CODE,
  normalizeTerminalActionError,
  terminalActionError,
  type TerminalActionErrorCode,
} from "./terminal-action-failure.js"

export type FailureTombstone = Readonly<{
  readonly resultId: ResultId
  readonly creatorId: PrincipalId
  readonly selectedOrigin: SelectedPublicOrigin
  readonly code: TerminalActionErrorCode
  readonly expiresAtMs: number
}>

type FailureTombstoneOptions = Readonly<{
  readonly ledger: ResultReservationLedger
  readonly resultTtlMs: number
  readonly auditSink: AiAuditSink
}>

export class FailureTombstones {
  readonly #records = new Map<ResultId, FailureTombstone>()

  public constructor(private readonly options: FailureTombstoneOptions) {}

  public retain(input: Readonly<{
    readonly resultId: ResultId
    readonly creatorId: PrincipalId
    readonly selectedOrigin: SelectedPublicOrigin
    readonly error: unknown
    readonly nowMs: number
  }>): FailureTombstone {
    const error = normalizeTerminalActionError(input.error)
    this.#releaseExecutionReservation(input.resultId, error.code)
    const byteLength = new TextEncoder().encode(canonicalJson({ code: error.code })).byteLength
    const reserved = this.options.ledger.reserve({
      resultId: input.resultId,
      reservedBytes: byteLength,
      nowMs: input.nowMs,
      inFlightDeadlineMs: input.nowMs + this.options.resultTtlMs,
    })
    if (reserved.outcome !== RESULT_RESERVATION_OUTCOME.RESERVED) throw this.#invariantFailure(input)
    const prepared = this.options.ledger.prepareRetainedCommit({
      resultId: input.resultId,
      byteLength,
      completedAtMs: input.nowMs,
    })
    if (prepared.outcome !== RESULT_PREPARE_OUTCOME.PREPARED) throw this.#invariantFailure(input)
    const committed = this.options.ledger.commitRetained(prepared.token)
    if (committed.outcome !== RESULT_COMMIT_OUTCOME.COMMITTED) throw this.#invariantFailure(input)
    const record = Object.freeze({
      resultId: input.resultId,
      creatorId: input.creatorId,
      selectedOrigin: input.selectedOrigin,
      code: error.code,
      expiresAtMs: committed.expiresAtMs,
    })
    this.#records.set(record.resultId, record)
    return record
  }

  public get(resultId: ResultId): FailureTombstone | undefined {
    return this.#records.get(resultId)
  }

  public prune(nowMs: number): void {
    for (const [resultId, record] of this.#records) {
      if (record.expiresAtMs <= nowMs) this.#records.delete(resultId)
    }
  }

  public clear(): void {
    this.#records.clear()
  }

  #releaseExecutionReservation(resultId: ResultId, code: TerminalActionErrorCode): void {
    if (this.options.ledger.stateOf(resultId) !== RESULT_RESERVATION_STATE.IN_FLIGHT) return
    this.options.ledger.releaseFailure({
      resultId,
      reason: code === TERMINAL_ACTION_ERROR_CODE.RESULT_TOO_LARGE
        ? RESULT_FAILURE_RELEASE_REASON.LIMIT_EXCEEDED
        : RESULT_FAILURE_RELEASE_REASON.INVALID_CONTRACT,
    })
  }

  #invariantFailure(input: Pick<FailureTombstone, "resultId" | "creatorId">) {
    this.options.auditSink.record({
      reason: AI_AUDIT_REASON.LEDGER_ANOMALY,
      resultId: input.resultId,
      principalId: input.creatorId,
    })
    return terminalActionError(TERMINAL_ACTION_ERROR_CODE.UPSTREAM_BAD_RESPONSE)
  }
}
