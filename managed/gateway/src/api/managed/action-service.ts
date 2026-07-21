import {
  AUTHORIZATION_OPERATION,
  MANAGED_ERROR_CODE,
  deriveManagedServiceLimits,
  type AiActionRequest,
  type ControlPlaneConfig,
  type ResultReservationSnapshot,
} from "@happycastle/steel-managed-shared"
import type { Clock } from "../../domain/clock.js"
import { ActionJobOutcomeKind } from "../../domain/states.js"
import { createAcceptedAction, createPendingResult } from "./accepted-outcome.js"
import {
  type ActionJob,
  type ActionJobOutcome,
} from "./action-job.js"
import { ActionCapacity, type ActionLease } from "./action-capacity.js"
import { parseAiAction, requireActionAuthorization } from "./action-policy.js"
import { actionCapacityError } from "./capacity-errors.js"
import type { AiAuditSink, ControlPlaneExecutionPort } from "./execution-contract.js"
import { executeControlPlaneAction } from "./execution-port-runner.js"
import { materializeResult } from "./result-materializer.js"
import type { ResultIdFactory } from "./result-id-factory.js"
import { ResultRepository } from "./result-repository.js"
import { validateRetainedResult } from "./retained-result-validator.js"
import type { RetainedResultStore } from "./retained-result-store.js"
import {
  RESULT_LOOKUP_KIND,
  type AcceptedAction,
  type CompletedAction,
  type ResultLookup,
  type ResultRequest,
  type SubmitActionRequest,
} from "./service-contract.js"
import {
  normalizeTerminalActionError,
  terminalActionError,
  TERMINAL_ACTION_ERROR_CODE,
} from "./terminal-action-failure.js"
import { ManagedTransportError } from "./transport-error.js"

export type AiBrowserServiceOptions = Readonly<{
  readonly config: ControlPlaneConfig
  readonly executionPort: ControlPlaneExecutionPort
  readonly clock: Clock
  readonly resultIdFactory: ResultIdFactory
  readonly auditSink: AiAuditSink
  readonly resultStore?: RetainedResultStore | undefined
}>

export class AiBrowserService {
  readonly #limits
  readonly #actions
  readonly #repository
  readonly #jobs = new Map<ResultRequest["resultId"], ActionJob>()
  #closed = false

  public constructor(private readonly options: AiBrowserServiceOptions) {
    this.#limits = deriveManagedServiceLimits(options.config)
    this.#actions = new ActionCapacity(this.#limits.capability.actionCount)
    this.#repository = new ResultRepository({
      limits: this.#limits,
      reconcileMs: options.config.reconcileMs,
      auditSink: options.auditSink,
      store: options.resultStore,
    })
  }

  public submit(input: SubmitActionRequest): AcceptedAction {
    const action = parseAiAction(input.action)
    const lease = this.#actions.acquire(input.signal, this.#limits.capability.actionTimeoutMs)
    if (lease === undefined) {
      if (this.#actions.snapshot().closed) throw drainingError()
      throw actionCapacityError(this.options.config.reconcileMs)
    }
    const nowMs = this.#now()
    this.#repository.prune(nowMs)
    const resultId = this.options.resultIdFactory.next()
    this.#repository.reserve({
      resultId,
      action,
      selectedOrigin: input.selectedOrigin,
      principalId: input.principal.principalId,
      nowMs,
    })
    const done = this.#executeAndRetain({ resultId, action, request: input, lease })
    const job = Object.freeze({
      resultId,
      creatorId: input.principal.principalId,
      selectedOrigin: input.selectedOrigin,
      done,
    })
    this.#jobs.set(resultId, job)
    void done.then(() => {
      if (this.#jobs.get(resultId) === job) this.#jobs.delete(resultId)
    })
    return createAcceptedAction(resultId, input, this.options.config.reconcileMs)
  }

  public result(input: ResultRequest): ResultLookup {
    this.#repository.prune(this.#now())
    const record = this.#repository.get(input.resultId)
    if (record !== undefined) {
      return Object.freeze({ kind: RESULT_LOOKUP_KIND.COMPLETED, value: this.#validatedResult(record, input) })
    }
    const failure = this.#repository.failure(input.resultId)
    if (failure !== undefined) {
      requireVisibleResult(input, failure.selectedOrigin, failure.creatorId)
      throw terminalActionError(failure.code)
    }
    const job = this.#jobs.get(input.resultId)
    if (job === undefined) throw resultNotFound()
    requireVisibleResult(input, job.selectedOrigin, job.creatorId)
    return Object.freeze({
      kind: RESULT_LOOKUP_KIND.PENDING,
      outcome: createPendingResult(input.resultId, input, this.options.config.reconcileMs),
    })
  }

  public async waitForResult(input: ResultRequest): Promise<CompletedAction> {
    const job = this.#jobs.get(input.resultId)
    if (job === undefined) return completedLookup(this.result(input))
    requireVisibleResult(input, job.selectedOrigin, job.creatorId)
    const outcome = await job.done
    switch (outcome.kind) {
      case ActionJobOutcomeKind.COMPLETED:
        return outcome.value
      case ActionJobOutcomeKind.FAILED:
        throw outcome.error
    }
  }

  public gauges(): Readonly<{
    readonly action: ReturnType<ActionCapacity["snapshot"]>
    readonly result: ResultReservationSnapshot
  }> {
    return Object.freeze({ action: this.#actions.snapshot(), result: this.#repository.snapshot() })
  }

  public close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#actions.close()
    this.#jobs.clear()
    this.#repository.close()
  }

  #now(): number {
    const value = this.options.clock.now()
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError("managed AI clock must be a nonnegative safe integer")
    }
    return value
  }

  async #executeAndRetain(input: Readonly<{
    readonly resultId: ResultRequest["resultId"]
    readonly action: AiActionRequest
    readonly request: SubmitActionRequest
    readonly lease: ActionLease
  }>): Promise<ActionJobOutcome> {
    try {
      if (this.#closed) throw drainingError()
      const completion = await executeControlPlaneAction(this.options.executionPort, {
        resultId: input.resultId,
        action: input.action,
        principal: input.request.principal,
        context: input.request.context,
        selectedOrigin: input.request.selectedOrigin,
        signal: input.lease.signal,
      })
      if (this.#closed) throw drainingError()
      requireActionAuthorization({
        principal: input.request.principal,
        operation: AUTHORIZATION_OPERATION.AI_ACTION,
        ownerId: completion.ownerId,
        creatorId: input.request.principal.principalId,
      })
      const materialized = materializeResult({
        completion,
        creatorId: input.request.principal.principalId,
        selectedOrigin: input.request.selectedOrigin,
        config: this.options.config,
        transport: this.#limits.transport,
      })
      this.#repository.commit(materialized, completion.completedAtMs, input.request.principal.principalId)
      return Object.freeze({
        kind: ActionJobOutcomeKind.COMPLETED,
        value: this.#validatedResult(materialized.record, {
          resultId: input.resultId,
          principal: input.request.principal,
          context: input.request.context,
          selectedOrigin: input.request.selectedOrigin,
        }),
      })
    } catch (error) {
      const terminal = this.#closed
        ? terminalActionError(TERMINAL_ACTION_ERROR_CODE.MANAGER_DRAINING)
        : normalizeTerminalActionError(error)
      if (!this.#closed) {
        this.#repository.retainFailure({
          resultId: input.resultId,
          creatorId: input.request.principal.principalId,
          selectedOrigin: input.request.selectedOrigin,
          error: terminal,
          nowMs: this.#now(),
        })
      }
      return Object.freeze({ kind: ActionJobOutcomeKind.FAILED, error: terminal })
    } finally {
      this.#actions.release(input.lease)
    }
  }

  #validatedResult(
    record: NonNullable<ReturnType<ResultRepository["get"]>>,
    input: ResultRequest,
  ): CompletedAction {
    if (record.selectedOrigin !== input.selectedOrigin) throw resultNotFound()
    requireActionAuthorization({
      principal: input.principal,
      operation: AUTHORIZATION_OPERATION.RESULT_DOWNLOAD,
      ownerId: record.ownerId,
      creatorId: record.creatorId,
    })
    try {
      return validateRetainedResult({
        record,
        expectedResultId: input.resultId,
        selectedOrigin: input.selectedOrigin,
        config: this.options.config,
        transport: this.#limits.transport,
      })
    } catch {
      this.#repository.quarantine(input.resultId, input.principal.principalId)
      throw resultNotFound()
    }
  }
}

function resultNotFound(): ManagedTransportError {
  return new ManagedTransportError(MANAGED_ERROR_CODE.RESULT_NOT_FOUND, "The result was not found")
}

function requireVisibleResult(
  input: ResultRequest,
  selectedOrigin: ResultRequest["selectedOrigin"],
  creatorId: ResultRequest["principal"]["principalId"],
): void {
  if (selectedOrigin !== input.selectedOrigin) throw resultNotFound()
  requireActionAuthorization({
    principal: input.principal,
    operation: AUTHORIZATION_OPERATION.RESULT_DOWNLOAD,
    ownerId: creatorId,
    creatorId,
  })
}

function completedLookup(lookup: ResultLookup): CompletedAction {
  switch (lookup.kind) {
    case RESULT_LOOKUP_KIND.COMPLETED:
      return lookup.value
    case RESULT_LOOKUP_KIND.PENDING:
      throw new ManagedTransportError(MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE, "The result job was not awaitable")
  }
}

function drainingError(): ManagedTransportError {
  return new ManagedTransportError(MANAGED_ERROR_CODE.MANAGER_DRAINING, "Managed AI service is closing")
}
