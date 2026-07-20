import type {
  AdmissionTicketId,
  AllocationId,
  InstanceId,
  PublicSessionId,
  WorkerId,
} from "./ids.js"
import type { LifecycleOperation, WorkerMutation, WorkerTransportReason } from "./states.js"

export class GatewayCapacityError extends Error {
  public override readonly name: string = "GatewayCapacityError"
}

export class AdmissionBackpressureError extends GatewayCapacityError {
  public override readonly name = "AdmissionBackpressureError"

  public constructor(public readonly capacity: number) {
    super(`admission capacity ${capacity} is exhausted`)
  }
}

export class AdmissionAbortedError extends Error {
  public override readonly name = "AdmissionAbortedError"

  public constructor() {
    super("admission was already aborted")
  }
}

export class AdmissionTicketNotFoundError extends Error {
  public override readonly name = "AdmissionTicketNotFoundError"

  public constructor(public readonly ticketId: AdmissionTicketId) {
    super(`admission ticket ${ticketId} was not found`)
  }
}

export class AdmissionTransitionError extends Error {
  public override readonly name = "AdmissionTransitionError"

  public constructor(public readonly ticketId: AdmissionTicketId) {
    super(`admission ticket ${ticketId} cannot make the requested transition`)
  }
}

export class LifecycleCreateCancelledError extends Error {
  public override readonly name = "LifecycleCreateCancelledError"

  public constructor(
    public readonly ticketId: AdmissionTicketId,
    options?: ErrorOptions,
  ) {
    super(`admission ticket ${ticketId} was cancelled during worker creation`, options)
  }
}

export class LifecycleAbortedError extends Error {
  public override readonly name = "LifecycleAbortedError"

  public constructor(public readonly operation: LifecycleOperation) {
    super(`lifecycle operation ${operation} was aborted before mutation`)
  }
}

export class WorkerRegistryTransitionError extends Error {
  public override readonly name = "WorkerRegistryTransitionError"

  public constructor(public readonly allocationId: AllocationId) {
    super(`allocation ${allocationId} cannot make the requested transition`)
  }
}

export class DuplicateAllocationIdError extends Error {
  public override readonly name = "DuplicateAllocationIdError"

  public constructor(public readonly allocationId: AllocationId) {
    super(`allocation ${allocationId} is already owned`)
  }
}

export class DuplicatePublicSessionIdError extends Error {
  public override readonly name = "DuplicatePublicSessionIdError"

  public constructor(public readonly sessionId: PublicSessionId) {
    super(`public session ${sessionId} is already owned`)
  }
}

export class StaleWorkerGenerationError extends Error {
  public override readonly name = "StaleWorkerGenerationError"

  public constructor(
    public readonly workerId: WorkerId,
    public readonly instanceId: InstanceId,
  ) {
    super(`worker ${workerId} instance ${instanceId} is stale`)
  }
}

export class SessionNotFoundError extends Error {
  public override readonly name = "SessionNotFoundError"

  public constructor(public readonly sessionId: PublicSessionId) {
    super(`session ${sessionId} was not found`)
  }
}

export class NoLiveSessionError extends Error {
  public override readonly name = "NoLiveSessionError"

  public constructor() {
    super("no live session is available")
  }
}

export const AdmissionConfigurationField = {
  CAPACITY: "CAPACITY",
  RETAINED_TERMINAL_CAPACITY: "RETAINED_TERMINAL_CAPACITY",
  TICKET_TTL_MILLISECONDS: "TICKET_TTL_MILLISECONDS",
} as const
export type AdmissionConfigurationField =
  (typeof AdmissionConfigurationField)[keyof typeof AdmissionConfigurationField]

export class AdmissionConfigurationError extends Error {
  public override readonly name = "AdmissionConfigurationError"

  public constructor(
    public readonly field: AdmissionConfigurationField,
    public readonly value: number,
  ) {
    super(`admission configuration ${field} has invalid value ${value}`)
  }
}

export class AmbiguousSessionAffinityError extends Error {
  public override readonly name = "AmbiguousSessionAffinityError"

  public constructor(public readonly liveSessionCount: number) {
    super(`${liveSessionCount} live sessions require an explicit affinity hint`)
  }
}

export class EventLedgerCapacityError extends Error {
  public override readonly name = "EventLedgerCapacityError"

  public constructor(public readonly capacity = 0) {
    super(`event ledger capacity ${capacity} is invalid`)
  }
}

export class UnexpectedVariantError extends Error {
  public override readonly name = "UnexpectedVariantError"

  public constructor() {
    super("an unreachable gateway variant was encountered")
  }
}

export class WorkerAdapterError extends Error {
  public override readonly name: string = "WorkerAdapterError"

  public constructor(
    public readonly workerId: WorkerId,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

export class WorkerHttpStatusError extends WorkerAdapterError {
  public override readonly name = "WorkerHttpStatusError"

  public constructor(workerId: WorkerId, public readonly statusCode: number) {
    super(workerId, `worker ${workerId} returned HTTP ${statusCode}`)
  }
}

export class WorkerIdentityMismatchError extends WorkerAdapterError {
  public override readonly name = "WorkerIdentityMismatchError"

  public constructor(workerId: WorkerId, public readonly instanceId: InstanceId) {
    super(workerId, `worker ${workerId} returned mismatched identity for ${instanceId}`)
  }
}

export class WorkerProtocolError extends WorkerAdapterError {
  public override readonly name = "WorkerProtocolError"
}

export class WorkerMutationNotStartedError extends WorkerAdapterError {
  public override readonly name = "WorkerMutationNotStartedError"

  public constructor(
    workerId: WorkerId,
    public readonly mutation: WorkerMutation,
    options?: ErrorOptions,
  ) {
    super(workerId, `worker ${workerId} mutation ${mutation} did not start`, options)
  }
}

export class WorkerTransportError extends WorkerAdapterError {
  public override readonly name = "WorkerTransportError"

  public constructor(
    workerId: WorkerId,
    public readonly reason: WorkerTransportReason,
    options?: ErrorOptions,
  ) {
    super(workerId, `worker ${workerId} transport failed: ${reason}`, options)
  }
}
