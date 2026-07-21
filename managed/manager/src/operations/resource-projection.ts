import {
  AdmissionState as GatewayAdmissionState,
  SessionState as GatewaySessionState,
  WorkerState as GatewayWorkerState,
  type AdmissionTicket,
  type PendingSessionCreate,
  type SessionRecord,
  type WorkerRecord,
} from "@happycastle/steel-managed-gateway"
import {
  ADMISSION_STATE,
  AdmissionIdSchema,
  AdmissionSchema,
  SESSION_STATE,
  SessionIdSchema,
  SessionSchema,
  WORKER_STATE,
  WorkerSchema,
  type Admission,
  type Session,
  type Worker,
} from "@happycastle/steel-managed-shared"

export function projectWorkerRecord(record: WorkerRecord): Worker {
  return WorkerSchema.parse({
    workerId: record.workerId,
    instanceId: record.instanceId,
    state: managedWorkerState(record.state),
    ...(workerSessionId(record) === undefined
      ? {}
      : { sessionId: SessionIdSchema.parse(workerSessionId(record)) }),
    lastSeenAt: isoTime(record.observedAt),
    stateChangedAt: isoTime(record.observedAt),
  })
}

export function projectSessionRecord(record: SessionRecord): Session {
  const base = {
    sessionId: SessionIdSchema.parse(record.publicSessionId),
    state: managedSessionState(record.state),
    workerId: record.workerId,
    instanceId: record.instanceId,
    createdAt: isoTime(record.createdAt),
    startedAt: isoTime(record.createdAt),
  }
  switch (record.state) {
    case GatewaySessionState.LIVE:
    case GatewaySessionState.RELEASING:
      return SessionSchema.parse(base)
    case GatewaySessionState.RELEASED:
    case GatewaySessionState.LOST:
      return SessionSchema.parse({
        ...base,
        endedAt: isoTime(record.terminalAt),
      })
    default:
      return unreachableState(record)
  }
}

export function projectAdmissionTicket(
  admissionId: string,
  ticket: AdmissionTicket<PendingSessionCreate>,
): Admission {
  const terminalAt = "terminalAt" in ticket ? ticket.terminalAt : ticket.createdAt
  return AdmissionSchema.parse({
    admissionId: AdmissionIdSchema.parse(admissionId),
    state: managedAdmissionState(ticket.state),
    ...(ticket.state === GatewayAdmissionState.COMPLETED
      ? { sessionId: SessionIdSchema.parse(ticket.payload.publicSessionId) }
      : {}),
    createdAt: isoTime(ticket.createdAt),
    expiresAt: isoTime(ticket.expiresAt),
    updatedAt: isoTime(terminalAt),
    ...(ticket.state === GatewayAdmissionState.SHUTDOWN
      ? { failureCode: "MANAGER_SHUTDOWN" }
      : {}),
  })
}

function managedWorkerState(state: WorkerRecord["state"]): Worker["state"] {
  switch (state) {
    case GatewayWorkerState.IDLE:
      return WORKER_STATE.IDLE
    case GatewayWorkerState.RESERVED:
      return WORKER_STATE.RESERVED
    case GatewayWorkerState.LIVE:
      return WORKER_STATE.LIVE
    case GatewayWorkerState.RELEASING:
    case GatewayWorkerState.RELEASE_UNCERTAIN:
      return WORKER_STATE.RELEASING
    case GatewayWorkerState.RELEASE_UNCERTAIN_UNREACHABLE:
    case GatewayWorkerState.UNREACHABLE:
      return WORKER_STATE.UNREACHABLE
    case GatewayWorkerState.QUARANTINED:
      return WORKER_STATE.QUARANTINED
    default:
      return unreachableState(state)
  }
}

function managedSessionState(state: SessionRecord["state"]): Session["state"] {
  switch (state) {
    case GatewaySessionState.LIVE:
      return SESSION_STATE.LIVE
    case GatewaySessionState.RELEASING:
      return SESSION_STATE.RELEASING
    case GatewaySessionState.RELEASED:
      return SESSION_STATE.RELEASED
    case GatewaySessionState.LOST:
      return SESSION_STATE.LOST
    default:
      return unreachableState(state)
  }
}

function managedAdmissionState(
  state: AdmissionTicket<PendingSessionCreate>["state"],
): Admission["state"] {
  switch (state) {
    case GatewayAdmissionState.QUEUED:
      return ADMISSION_STATE.QUEUED
    case GatewayAdmissionState.RESERVED:
      return ADMISSION_STATE.RESERVED
    case GatewayAdmissionState.COMPLETED:
      return ADMISSION_STATE.ADMITTED
    case GatewayAdmissionState.CANCELLED:
      return ADMISSION_STATE.CANCELLED
    case GatewayAdmissionState.EXPIRED:
      return ADMISSION_STATE.EXPIRED
    case GatewayAdmissionState.SHUTDOWN:
      return ADMISSION_STATE.FAILED
    default:
      return unreachableState(state)
  }
}

function workerSessionId(record: WorkerRecord): string | undefined {
  return "sessionId" in record ? record.sessionId : undefined
}

function isoTime(milliseconds: number): string {
  return new Date(milliseconds).toISOString()
}

function unreachableState(value: never): never {
  throw new RangeError(`unreachable managed projection state: ${String(value)}`)
}
