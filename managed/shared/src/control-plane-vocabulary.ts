import { STEEL_SERVING_TARGET, type SteelServingTarget } from "./deployment-vocabulary.js"
import { SESSION_ID_MODE } from "./upstream-corpus-model.js"

export const MANAGER_MODE = { SERVING: "SERVING", DRAINING: "DRAINING" } as const
export const HANDOVER_MODE = MANAGER_MODE
export const MANAGER_MODE_CAUSE = {
  CUTOVER: "CUTOVER",
  ROLLBACK: "ROLLBACK",
  REPROMOTION: "REPROMOTION",
  SHUTDOWN: "SHUTDOWN",
  RECOVERY: "RECOVERY",
} as const
export const EMERGENCY_RECOVERY_STATE = {
  MAINTENANCE: "MAINTENANCE",
  RECOVER_MANAGER: "RECOVER_MANAGER",
  NATURAL_QUIESCENCE: "NATURAL_QUIESCENCE",
  DESTRUCTIVE_STOPPED: "DESTRUCTIVE_STOPPED",
  SAFE_FOR_LEGACY: "SAFE_FOR_LEGACY",
} as const
export const PRINCIPAL_KIND = { USER: "USER", SERVICE_TOKEN: "SERVICE_TOKEN" } as const
export const PRINCIPAL_ROLE = { USER: "USER", OPERATOR: "OPERATOR" } as const
export const FINGERPRINT_BINDING_STAGE = { SCHEMA_ONLY: "SCHEMA_ONLY", BOUND: "BOUND" } as const
export const IDEMPOTENCY_SCOPE = { PRINCIPAL: "PRINCIPAL" } as const
export const CONTROL_PLANE_SESSION_ID_MODE = SESSION_ID_MODE
export const CREATE_JOURNAL_STATE = {
  ACCEPTED: "ACCEPTED",
  UPSTREAM_PENDING: "UPSTREAM_PENDING",
  LIVE: "LIVE",
  UNCERTAIN: "UNCERTAIN",
  RELEASED_TERMINAL: "RELEASED_TERMINAL",
  FAILED_TERMINAL: "FAILED_TERMINAL",
} as const
export const JOURNAL_ACCEPT_RESULT = {
  ACCEPTED: "ACCEPTED",
  CAPACITY: "CAPACITY",
  CONFLICT: "CONFLICT",
  DUPLICATE: "DUPLICATE",
  WORKER_BUSY: "WORKER_BUSY",
} as const
export const CREATE_REPLAY_STATE = {
  QUEUED: "QUEUED",
  RESERVED: "RESERVED",
  STARTING: "STARTING",
  WORKER_PENDING: "WORKER_PENDING",
  LIVE: "LIVE",
  CANCELLED_TERMINAL: "CANCELLED_TERMINAL",
  EXPIRED_TERMINAL: "EXPIRED_TERMINAL",
  RELEASED_TERMINAL: "RELEASED_TERMINAL",
  FAILED_TERMINAL: "FAILED_TERMINAL",
} as const
export const WORKER_STATE = {
  DISCOVERED: "DISCOVERED",
  REACHABLE: "REACHABLE",
  IDLE: "IDLE",
  RESERVED: "RESERVED",
  STARTING: "STARTING",
  LIVE: "LIVE",
  RELEASING: "RELEASING",
  UNREACHABLE: "UNREACHABLE",
  QUARANTINED: "QUARANTINED",
  DRAINING: "DRAINING",
} as const
export const SESSION_STATE = {
  QUEUED: "QUEUED",
  STARTING: "STARTING",
  LIVE: "LIVE",
  RELEASING: "RELEASING",
  RELEASED: "RELEASED",
  FAILED: "FAILED",
  LOST: "LOST",
} as const
export const ADMISSION_STATE = {
  QUEUED: "QUEUED",
  RESERVED: "RESERVED",
  STARTING: "STARTING",
  ADMITTED: "ADMITTED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
  FAILED: "FAILED",
} as const
export const EVENT_TYPE = {
  WORKER_STATE_CHANGED: "WORKER_STATE_CHANGED",
  SESSION_STATE_CHANGED: "SESSION_STATE_CHANGED",
  ADMISSION_STATE_CHANGED: "ADMISSION_STATE_CHANGED",
  CREATE_RECOVERY: "CREATE_RECOVERY",
  INSTANCE_LOST: "INSTANCE_LOST",
  MANAGER_MODE_CHANGED: "MANAGER_MODE_CHANGED",
} as const
export const CREATE_RECOVERY_OUTCOME = {
  RECOVERED: "RECOVERED",
  QUARANTINED: "QUARANTINED",
} as const
export const INSTANCE_LOST_REASON = {
  INSTANCE_CHANGED: "INSTANCE_CHANGED",
  WORKER_RESTARTED: "WORKER_RESTARTED",
} as const
export const MANAGER_MODE_TRANSITION = { DRAIN: "DRAIN", RESUME: "RESUME" } as const
export const CREATE_REPLAY_TEMPLATE_KIND = { PUBLIC_URL: "PUBLIC_URL" } as const
export const LEGACY_BOOTSTRAP_STATE = {
  SERVING: "SERVING",
  EDGE_FENCED: "EDGE_FENCED",
  QUIESCENT: "QUIESCENT",
  STOPPED: "STOPPED",
} as const
export const RESULT_KIND = {
  SESSION: "session",
  ADMISSION: "admission",
  ACTION: "action",
  TEXT: "text",
  BINARY: "binary",
  NAVIGATION: "navigation",
  LIVE_VIEW: "live_view",
} as const
export const TOOL_MUTABILITY = { READ: "READ", WRITE: "WRITE" } as const
export const TOOL_SESSION_REQUIREMENT = { NONE: "NONE", EXPLICIT: "EXPLICIT" } as const
export const TOOL_OUTPUT_POLICY = {
  STRUCTURED: "STRUCTURED",
  TEXT_BOUNDED: "TEXT_BOUNDED",
  BINARY_RETAINED: "BINARY_RETAINED",
  LIVE_INSTANCE_BOUND: "LIVE_INSTANCE_BOUND",
} as const
export const STEEL_ROUTE_TARGET = STEEL_SERVING_TARGET

export type ManagerMode = (typeof MANAGER_MODE)[keyof typeof MANAGER_MODE]
export type ManagerModeCause = (typeof MANAGER_MODE_CAUSE)[keyof typeof MANAGER_MODE_CAUSE]
export type EmergencyRecoveryState = (typeof EMERGENCY_RECOVERY_STATE)[keyof typeof EMERGENCY_RECOVERY_STATE]
export type PrincipalKind = (typeof PRINCIPAL_KIND)[keyof typeof PRINCIPAL_KIND]
export type PrincipalRole = (typeof PRINCIPAL_ROLE)[keyof typeof PRINCIPAL_ROLE]
export type FingerprintBindingStage = (typeof FINGERPRINT_BINDING_STAGE)[keyof typeof FINGERPRINT_BINDING_STAGE]
export type IdempotencyScope = (typeof IDEMPOTENCY_SCOPE)[keyof typeof IDEMPOTENCY_SCOPE]
export type SessionIdMode = (typeof CONTROL_PLANE_SESSION_ID_MODE)[keyof typeof CONTROL_PLANE_SESSION_ID_MODE]
export type CreateJournalState = (typeof CREATE_JOURNAL_STATE)[keyof typeof CREATE_JOURNAL_STATE]
export type JournalAcceptResult = (typeof JOURNAL_ACCEPT_RESULT)[keyof typeof JOURNAL_ACCEPT_RESULT]
export type CreateReplayState = (typeof CREATE_REPLAY_STATE)[keyof typeof CREATE_REPLAY_STATE]
export type WorkerState = (typeof WORKER_STATE)[keyof typeof WORKER_STATE]
export type SessionState = (typeof SESSION_STATE)[keyof typeof SESSION_STATE]
export type AdmissionState = (typeof ADMISSION_STATE)[keyof typeof ADMISSION_STATE]
export type EventType = (typeof EVENT_TYPE)[keyof typeof EVENT_TYPE]
export type CreateRecoveryOutcome = (typeof CREATE_RECOVERY_OUTCOME)[keyof typeof CREATE_RECOVERY_OUTCOME]
export type InstanceLostReason = (typeof INSTANCE_LOST_REASON)[keyof typeof INSTANCE_LOST_REASON]
export type ManagerModeTransition = (typeof MANAGER_MODE_TRANSITION)[keyof typeof MANAGER_MODE_TRANSITION]
export type CreateReplayTemplateKind = (typeof CREATE_REPLAY_TEMPLATE_KIND)[keyof typeof CREATE_REPLAY_TEMPLATE_KIND]
export type LegacyBootstrapState = (typeof LEGACY_BOOTSTRAP_STATE)[keyof typeof LEGACY_BOOTSTRAP_STATE]
export type ResultKind = (typeof RESULT_KIND)[keyof typeof RESULT_KIND]
export type ToolMutability = (typeof TOOL_MUTABILITY)[keyof typeof TOOL_MUTABILITY]
export type ToolSessionRequirement = (typeof TOOL_SESSION_REQUIREMENT)[keyof typeof TOOL_SESSION_REQUIREMENT]
export type ToolOutputPolicy = (typeof TOOL_OUTPUT_POLICY)[keyof typeof TOOL_OUTPUT_POLICY]
export type SteelRouteTarget = SteelServingTarget

const enumMembers = (value: Readonly<Record<string, string>>): readonly string[] => Object.freeze(Object.values(value))

export const CONTROL_PLANE_ENUM_VOCABULARY = {
  ManagerMode: enumMembers(MANAGER_MODE),
  ManagerModeCause: enumMembers(MANAGER_MODE_CAUSE),
  EmergencyRecoveryState: enumMembers(EMERGENCY_RECOVERY_STATE),
  PrincipalKind: enumMembers(PRINCIPAL_KIND),
  PrincipalRole: enumMembers(PRINCIPAL_ROLE),
  FingerprintBindingStage: enumMembers(FINGERPRINT_BINDING_STAGE),
  IdempotencyScope: enumMembers(IDEMPOTENCY_SCOPE),
  SessionIdMode: enumMembers(CONTROL_PLANE_SESSION_ID_MODE),
  CreateJournalState: enumMembers(CREATE_JOURNAL_STATE),
  JournalAcceptResult: enumMembers(JOURNAL_ACCEPT_RESULT),
  CreateReplayState: enumMembers(CREATE_REPLAY_STATE),
  WorkerState: enumMembers(WORKER_STATE),
  SessionState: enumMembers(SESSION_STATE),
  AdmissionState: enumMembers(ADMISSION_STATE),
  EventType: enumMembers(EVENT_TYPE),
  CreateRecoveryOutcome: enumMembers(CREATE_RECOVERY_OUTCOME),
  InstanceLostReason: enumMembers(INSTANCE_LOST_REASON),
  ManagerModeTransition: enumMembers(MANAGER_MODE_TRANSITION),
  CreateReplayTemplateKind: enumMembers(CREATE_REPLAY_TEMPLATE_KIND),
  LegacyBootstrapState: enumMembers(LEGACY_BOOTSTRAP_STATE),
  ResultKind: enumMembers(RESULT_KIND),
  ToolMutability: enumMembers(TOOL_MUTABILITY),
  ToolSessionRequirement: enumMembers(TOOL_SESSION_REQUIREMENT),
  ToolOutputPolicy: enumMembers(TOOL_OUTPUT_POLICY),
} as const satisfies Readonly<Record<string, readonly string[]>>

export const CONTROL_PLANE_CLOSED_STATE_MEMBERS = Object.freeze(
  Array.from(new Set(Object.values(CONTROL_PLANE_ENUM_VOCABULARY).flat())).sort(),
)
