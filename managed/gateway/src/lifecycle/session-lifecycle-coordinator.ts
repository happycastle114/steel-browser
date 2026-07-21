import type { AdmissionQueue } from "../admission/admission-queue.js"
import type { IdGenerator } from "../domain/clock.js"
import {
  LifecycleAbortedError,
  LifecycleCreateCancelledError,
  WorkerMutationNotStartedError,
  WorkerProtocolError,
} from "../domain/errors.js"
import { assertNever } from "../domain/exhaustive.js"
import type { AdmissionTicketId, AllocationId, PublicSessionId } from "../domain/ids.js"
import {
  AdmissionState,
  LifecycleCreateKind,
  LifecycleOperation,
} from "../domain/states.js"
import type { SessionRecord, WorkerDescriptor } from "../registry/registry-model.js"
import type { WorkerRegistry } from "../registry/worker-registry.js"
import type { WorkerHttpClient } from "../worker/worker-http-contract.js"
import type {
  LifecycleCreatedResult,
  LifecycleCreateResult,
  ManagedCreateHeaderFactory,
  PendingSessionCreate,
} from "./lifecycle-model.js"

type SessionLifecycleOptions = {
  readonly registry: WorkerRegistry
  readonly admissions: AdmissionQueue<PendingSessionCreate>
  readonly client: WorkerHttpClient
  readonly ids: IdGenerator
}

type StartSessionInput = {
  readonly worker: WorkerDescriptor
  readonly allocationId: AllocationId
  readonly pending: PendingSessionCreate
  readonly signal: AbortSignal
  readonly admissionTicketId?: AdmissionTicketId
}

export class SessionLifecycleCoordinator {
  private readonly registry: WorkerRegistry
  private readonly admissions: AdmissionQueue<PendingSessionCreate>
  private readonly client: WorkerHttpClient
  private readonly ids: IdGenerator

  public constructor(options: SessionLifecycleOptions) {
    this.registry = options.registry
    this.admissions = options.admissions
    this.client = options.client
    this.ids = options.ids
  }

  public async create(
    signal: AbortSignal,
    managedCreate?: ManagedCreateHeaderFactory,
  ): Promise<LifecycleCreateResult> {
    this.requireActiveSignal(signal, LifecycleOperation.CREATE)
    const publicSessionId = this.ids.nextPublicSessionId()
    const managedHeaders = managedCreate === undefined
      ? undefined
      : await managedCreate(publicSessionId)
    const pending = {
      publicSessionId,
      ...(managedHeaders === undefined ? {} : { managedCreate: managedHeaders }),
    }
    const allocationId = this.ids.nextAllocationId()
    const worker = this.registry.reserveNext(allocationId)
    if (worker === undefined) {
      const ticket = this.admissions.enqueue(pending, signal)
      return {
        kind: LifecycleCreateKind.QUEUED,
        publicSessionId: pending.publicSessionId,
        admissionTicketId: ticket.id,
      }
    }
    return this.start({ worker, allocationId, pending, signal })
  }

  public async processNext(signal: AbortSignal): Promise<LifecycleCreateResult | undefined> {
    this.requireActiveSignal(signal, LifecycleOperation.PROCESS_NEXT)
    const allocationId = this.ids.nextAllocationId()
    const worker = this.registry.reserveNext(allocationId)
    if (worker === undefined) return undefined
    const ticket = this.admissions.reserveNext(allocationId)
    if (ticket === undefined) {
      this.registry.cancelReservation(allocationId)
      return undefined
    }
    if (ticket.state !== AdmissionState.RESERVED) {
      this.registry.cancelReservation(allocationId)
      return undefined
    }
    try {
      const result = await this.start({
        worker,
        allocationId,
        pending: ticket.payload,
        signal,
        admissionTicketId: ticket.id,
      })
      return await this.settleHandoff(ticket.id, result)
    } catch (error) {
      this.admissions.cancel(ticket.id)
      throw error
    }
  }

  public async release(sessionId: PublicSessionId, signal: AbortSignal): Promise<SessionRecord> {
    this.requireActiveSignal(signal, LifecycleOperation.RELEASE)
    const session = this.registry.beginRelease(sessionId)
    const worker = this.registry.workerForSession(sessionId)
    try {
      await this.client.release(worker, session.upstreamSessionId, signal)
      const listed = await this.client.list(worker, signal)
      if (listed.sessions.length > 0) {
        throw new WorkerProtocolError(worker.workerId, "worker remained busy after release")
      }
      return this.registry.reconcileReleased(sessionId, worker)
    } catch (error) {
      if (error instanceof WorkerMutationNotStartedError) {
        this.registry.cancelRelease(sessionId)
      } else {
        this.registry.markReleaseUncertain(sessionId)
      }
      throw error
    }
  }

  private async start(input: StartSessionInput): Promise<LifecycleCreatedResult> {
    try {
      const created = await this.client.create(
        input.worker,
        {
          ...(input.pending.managedCreate === undefined
            ? {}
            : { managedCreate: input.pending.managedCreate }),
          publicSessionId: input.pending.publicSessionId,
        },
        input.signal,
      )
      const session = this.registry.bindSession({
        allocationId: input.allocationId,
        publicSessionId: input.pending.publicSessionId,
        upstreamSessionId: created.upstreamSessionId,
      })
      return input.admissionTicketId === undefined
        ? { kind: LifecycleCreateKind.CREATED, session }
        : { kind: LifecycleCreateKind.CREATED, session, admissionTicketId: input.admissionTicketId }
    } catch (error) {
      if (error instanceof WorkerMutationNotStartedError) {
        this.registry.cancelReservation(input.allocationId)
      } else {
        this.registry.quarantineReservation(input.allocationId)
      }
      throw error
    }
  }

  private async settleHandoff(
    ticketId: AdmissionTicketId,
    result: LifecycleCreatedResult,
  ): Promise<LifecycleCreatedResult> {
    const ticket = this.admissions.get(ticketId)
    if (ticket !== undefined) {
      switch (ticket.state) {
        case AdmissionState.RESERVED:
          this.admissions.complete(ticketId)
          return result
        case AdmissionState.QUEUED:
        case AdmissionState.CANCELLED:
        case AdmissionState.EXPIRED:
        case AdmissionState.COMPLETED:
        case AdmissionState.SHUTDOWN:
          break
        default:
          return assertNever(ticket)
      }
    }
    try {
      await this.release(result.session.publicSessionId, new AbortController().signal)
    } catch (error) {
      throw new LifecycleCreateCancelledError(ticketId, { cause: error })
    }
    throw new LifecycleCreateCancelledError(ticketId)
  }

  private requireActiveSignal(signal: AbortSignal, operation: LifecycleOperation): void {
    if (signal.aborted) throw new LifecycleAbortedError(operation)
  }
}
