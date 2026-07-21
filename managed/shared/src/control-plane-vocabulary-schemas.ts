import { z } from "zod"

import {
  ADMISSION_STATE,
  CREATE_RECOVERY_OUTCOME,
  CREATE_JOURNAL_STATE,
  CREATE_REPLAY_TEMPLATE_KIND,
  CREATE_REPLAY_STATE,
  EMERGENCY_RECOVERY_STATE,
  EVENT_TYPE,
  FINGERPRINT_BINDING_STAGE,
  IDEMPOTENCY_SCOPE,
  INSTANCE_LOST_REASON,
  LEGACY_BOOTSTRAP_STATE,
  MANAGER_MODE,
  MANAGER_MODE_CAUSE,
  MANAGER_MODE_TRANSITION,
  PRINCIPAL_KIND,
  PRINCIPAL_ROLE,
  RESULT_KIND,
  CONTROL_PLANE_SESSION_ID_MODE,
  SESSION_STATE,
  STEEL_ROUTE_TARGET,
  TOOL_MUTABILITY,
  TOOL_OUTPUT_POLICY,
  TOOL_SESSION_REQUIREMENT,
  WORKER_STATE,
} from "./control-plane-vocabulary.js"

export const ManagerModeSchema = z.nativeEnum(MANAGER_MODE)
export const ManagerModeCauseSchema = z.nativeEnum(MANAGER_MODE_CAUSE)
export const EmergencyRecoveryStateSchema = z.nativeEnum(EMERGENCY_RECOVERY_STATE)
export const PrincipalKindSchema = z.nativeEnum(PRINCIPAL_KIND)
export const PrincipalRoleSchema = z.nativeEnum(PRINCIPAL_ROLE)
export const FingerprintBindingStageSchema = z.nativeEnum(FINGERPRINT_BINDING_STAGE)
export const IdempotencyScopeSchema = z.nativeEnum(IDEMPOTENCY_SCOPE)
export const SessionIdModeSchema = z.nativeEnum(CONTROL_PLANE_SESSION_ID_MODE)
export const CreateJournalStateSchema = z.nativeEnum(CREATE_JOURNAL_STATE)
export const CreateReplayStateSchema = z.nativeEnum(CREATE_REPLAY_STATE)
export const WorkerStateSchema = z.nativeEnum(WORKER_STATE)
export const SessionStateSchema = z.nativeEnum(SESSION_STATE)
export const AdmissionStateSchema = z.nativeEnum(ADMISSION_STATE)
export const EventTypeSchema = z.nativeEnum(EVENT_TYPE)
export const CreateRecoveryOutcomeSchema = z.nativeEnum(CREATE_RECOVERY_OUTCOME)
export const InstanceLostReasonSchema = z.nativeEnum(INSTANCE_LOST_REASON)
export const ManagerModeTransitionSchema = z.nativeEnum(MANAGER_MODE_TRANSITION)
export const CreateReplayTemplateKindSchema = z.nativeEnum(CREATE_REPLAY_TEMPLATE_KIND)
export const LegacyBootstrapStateSchema = z.nativeEnum(LEGACY_BOOTSTRAP_STATE)
export const ResultKindSchema = z.nativeEnum(RESULT_KIND)
export const ToolMutabilitySchema = z.nativeEnum(TOOL_MUTABILITY)
export const ToolSessionRequirementSchema = z.nativeEnum(TOOL_SESSION_REQUIREMENT)
export const ToolOutputPolicySchema = z.nativeEnum(TOOL_OUTPUT_POLICY)
export const SteelRouteTargetSchema = z.nativeEnum(STEEL_ROUTE_TARGET)
