import {
  MANAGED_ERROR_CODE,
  RESULT_COMMIT_OUTCOME,
  RESULT_FAILURE_RELEASE_REASON,
  RESULT_PREPARE_OUTCOME,
  RESULT_RESERVATION_AUDIT_REASON,
  RESULT_RESERVATION_OUTCOME,
  ResultReservationLedger,
  TOOL_OUTPUT_POLICY,
  createToolDefinitionRegistry,
  type AiActionRequest,
  type ManagedServiceLimits,
  type PrincipalId,
  type ResultId,
  type ResultReservationSnapshot,
  type SelectedPublicOrigin,
} from "@happycastle/steel-managed-shared"
import { resultCapacityError } from "./capacity-errors.js"
import { AI_AUDIT_REASON, type AiAuditSink } from "./execution-contract.js"
import { FailureTombstones, type FailureTombstone } from "./failure-tombstones.js"
import type { MaterializedResult } from "./result-materializer.js"
import {
  InMemoryRetainedResultStore,
  type RetainedResultRecord,
  type RetainedResultStore,
} from "./retained-result-store.js"
import { ManagedTransportError } from "./transport-error.js"

type RepositoryOptions = Readonly<{
  readonly limits: ManagedServiceLimits
  readonly reconcileMs: number
  readonly auditSink: AiAuditSink
  readonly store?: RetainedResultStore | undefined
}>

export class ResultRepository {
  readonly #ledger: ResultReservationLedger
  readonly #store: RetainedResultStore
  readonly #failures: FailureTombstones

  public constructor(private readonly options: RepositoryOptions) {
    this.#ledger = new ResultReservationLedger({
      limitBytes: options.limits.transport.resultBytes,
      limitCount: options.limits.capability.resultCount,
      resultTtlMs: options.limits.resultTtlMs,
    })
    this.#store = options.store ?? new InMemoryRetainedResultStore()
    this.#failures = new FailureTombstones({
      ledger: this.#ledger,
      resultTtlMs: options.limits.resultTtlMs,
      auditSink: options.auditSink,
    })
  }

  public reserve(input: Readonly<{
    readonly resultId: ResultId
    readonly action: AiActionRequest
    readonly selectedOrigin: SelectedPublicOrigin
    readonly principalId: PrincipalId
    readonly nowMs: number
  }>): void {
    const policy = createToolDefinitionRegistry(input.selectedOrigin, this.options.limits.transport)
      [input.action.tool.name].outputPolicy
    const reservedBytes = policy === TOOL_OUTPUT_POLICY.BINARY_RETAINED
      ? Math.min(this.options.limits.transport.binaryBytes, this.options.limits.transport.resultBytes)
      : Math.min(this.options.limits.transport.httpBodyBytes, this.options.limits.transport.resultBytes)
    const outcome = this.#ledger.reserve({
      resultId: input.resultId,
      reservedBytes,
      nowMs: input.nowMs,
      inFlightDeadlineMs: input.nowMs + this.options.limits.capability.actionTimeoutMs,
    })
    if (outcome.outcome === RESULT_RESERVATION_OUTCOME.CAPACITY) {
      throw resultCapacityError(outcome.exhaustion, input.nowMs, this.options.reconcileMs)
    }
    if (outcome.outcome !== RESULT_RESERVATION_OUTCOME.RESERVED) {
      throw this.#failure(AI_AUDIT_REASON.LEDGER_ANOMALY, input.resultId, input.principalId)
    }
  }

  public commit(
    materialized: MaterializedResult,
    completedAtMs: number,
    principalId: PrincipalId,
  ): void {
    const resultId = materialized.record.resultId
    const prepared = this.#ledger.prepareRetainedCommit({
      resultId,
      byteLength: materialized.byteLength,
      completedAtMs,
    })
    if (prepared.outcome !== RESULT_PREPARE_OUTCOME.PREPARED) {
      throw this.#failure(AI_AUDIT_REASON.LEDGER_ANOMALY, resultId, principalId)
    }
    if (!this.#stage(materialized.record, prepared.token)) {
      throw this.#failure(AI_AUDIT_REASON.RESULT_STORE_FAILURE, resultId, principalId)
    }
    const committed = this.#ledger.commitRetained(prepared.token)
    if (committed.outcome !== RESULT_COMMIT_OUTCOME.COMMITTED) {
      this.#store.delete(resultId)
      this.#ledger.abortPrepared({ token: prepared.token, reason: RESULT_FAILURE_RELEASE_REASON.RETAINED_COMMIT_ABORTED })
      throw this.#failure(AI_AUDIT_REASON.LEDGER_ANOMALY, resultId, principalId)
    }
    if (!this.#publish(resultId)) {
      this.#store.delete(resultId)
      this.#ledger.quarantineRetained({ resultId, reason: RESULT_RESERVATION_AUDIT_REASON.CORRUPT_RETAINED_RECORD })
      throw this.#failure(AI_AUDIT_REASON.RESULT_STORE_FAILURE, resultId, principalId)
    }
  }

  public get(resultId: ResultId): RetainedResultRecord | undefined {
    return this.#store.get(resultId)
  }

  public failure(resultId: ResultId): FailureTombstone | undefined {
    return this.#failures.get(resultId)
  }

  public retainFailure(input: Readonly<{
    readonly resultId: ResultId
    readonly creatorId: PrincipalId
    readonly selectedOrigin: SelectedPublicOrigin
    readonly error: unknown
    readonly nowMs: number
  }>): FailureTombstone {
    return this.#failures.retain(input)
  }

  public quarantine(resultId: ResultId, principalId: PrincipalId): void {
    this.#store.delete(resultId)
    this.#ledger.quarantineRetained({
      resultId,
      reason: RESULT_RESERVATION_AUDIT_REASON.CORRUPT_RETAINED_RECORD,
    })
    this.options.auditSink.record({ reason: AI_AUDIT_REASON.CORRUPT_RETAINED_RECORD, resultId, principalId })
  }

  public prune(nowMs: number): void {
    this.#failures.prune(nowMs)
    this.#store.prune(nowMs)
    this.#ledger.expire(nowMs)
  }

  public close(): void {
    this.#failures.clear()
    this.#store.clear()
    this.#ledger.expire(Number.MAX_SAFE_INTEGER)
  }

  public snapshot(): ResultReservationSnapshot {
    return this.#ledger.snapshot()
  }

  #stage(record: RetainedResultRecord, token: Parameters<ResultReservationLedger["commitRetained"]>[0]): boolean {
    try {
      if (this.#store.stage(record)) return true
    } catch {
      this.#ledger.abortPrepared({ token, reason: RESULT_FAILURE_RELEASE_REASON.RETAINED_COMMIT_ABORTED })
      return false
    }
    this.#ledger.abortPrepared({ token, reason: RESULT_FAILURE_RELEASE_REASON.RETAINED_COMMIT_ABORTED })
    return false
  }

  #publish(resultId: ResultId): boolean {
    try {
      return this.#store.publish(resultId)
    } catch {
      return false
    }
  }

  #failure(reason: typeof AI_AUDIT_REASON.LEDGER_ANOMALY | typeof AI_AUDIT_REASON.RESULT_STORE_FAILURE, resultId: ResultId, principalId: PrincipalId) {
    this.options.auditSink.record({ reason, resultId, principalId })
    return new ManagedTransportError(MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE, "The retained result commit failed")
  }
}
