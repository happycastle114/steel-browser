export const WorkerState = {
  IDLE: "IDLE",
  RESERVED: "RESERVED",
  LIVE: "LIVE",
  RELEASING: "RELEASING",
  RELEASE_UNCERTAIN: "RELEASE_UNCERTAIN",
  RELEASE_UNCERTAIN_UNREACHABLE: "RELEASE_UNCERTAIN_UNREACHABLE",
  UNREACHABLE: "UNREACHABLE",
  QUARANTINED: "QUARANTINED",
} as const
export type WorkerState = (typeof WorkerState)[keyof typeof WorkerState]

export const WorkerRemoteState = {
  IDLE: "IDLE",
  BUSY: "BUSY",
  UNAVAILABLE: "UNAVAILABLE",
} as const
export type WorkerRemoteState = (typeof WorkerRemoteState)[keyof typeof WorkerRemoteState]

export const SessionState = {
  LIVE: "LIVE",
  RELEASING: "RELEASING",
  RELEASED: "RELEASED",
  LOST: "LOST",
} as const
export type SessionState = (typeof SessionState)[keyof typeof SessionState]

export const AdmissionState = {
  QUEUED: "QUEUED",
  RESERVED: "RESERVED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
  COMPLETED: "COMPLETED",
  SHUTDOWN: "SHUTDOWN",
} as const
export type AdmissionState = (typeof AdmissionState)[keyof typeof AdmissionState]

export const GatewayEventType = {
  WORKER_OBSERVED: "WORKER_OBSERVED",
  WORKER_REPLACED: "WORKER_REPLACED",
  WORKER_QUARANTINED: "WORKER_QUARANTINED",
  SESSION_RESERVED: "SESSION_RESERVED",
  SESSION_BOUND: "SESSION_BOUND",
  SESSION_RELEASING: "SESSION_RELEASING",
  SESSION_RELEASE_UNCERTAIN: "SESSION_RELEASE_UNCERTAIN",
  SESSION_RELEASE_RECOVERED: "SESSION_RELEASE_RECOVERED",
  SESSION_RELEASE_CANCELLED: "SESSION_RELEASE_CANCELLED",
  SESSION_RELEASED: "SESSION_RELEASED",
  SESSION_LOST: "SESSION_LOST",
} as const
export type GatewayEventType = (typeof GatewayEventType)[keyof typeof GatewayEventType]

export const ObservationCommitKind = {
  COMMITTED: "COMMITTED",
  STALE_OBSERVATION: "STALE_OBSERVATION",
} as const
export type ObservationCommitKind =
  (typeof ObservationCommitKind)[keyof typeof ObservationCommitKind]

export const WorkerTransportReason = {
  ABORTED: "ABORTED",
  NETWORK: "NETWORK",
} as const
export type WorkerTransportReason =
  (typeof WorkerTransportReason)[keyof typeof WorkerTransportReason]

export const ReconcileOutcome = {
  COMMITTED: "COMMITTED",
  STALE: "STALE",
  UNREACHABLE: "UNREACHABLE",
} as const
export type ReconcileOutcome = (typeof ReconcileOutcome)[keyof typeof ReconcileOutcome]

export const LifecycleCreateKind = {
  CREATED: "CREATED",
  QUEUED: "QUEUED",
} as const
export type LifecycleCreateKind =
  (typeof LifecycleCreateKind)[keyof typeof LifecycleCreateKind]

export const LifecycleOperation = {
  CREATE: "CREATE",
  PROCESS_NEXT: "PROCESS_NEXT",
  RELEASE: "RELEASE",
} as const
export type LifecycleOperation =
  (typeof LifecycleOperation)[keyof typeof LifecycleOperation]

export const WorkerMutation = {
  CREATE: "CREATE",
  RELEASE: "RELEASE",
} as const
export type WorkerMutation = (typeof WorkerMutation)[keyof typeof WorkerMutation]
