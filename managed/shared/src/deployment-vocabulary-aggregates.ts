import { LISTENER_ENUM_VOCABULARY } from "./deployment-listener-vocabulary.js"
import {
  CAPACITY_GATE_OUTCOME,
  CAPACITY_PHASE,
  COMPOSITE_ROUTE_PHASE,
  COOLIFY_COMPOSE_DEPLOYMENT_MODE,
  COOLIFY_CUTOVER_MODE,
  COOLIFY_DEPLOYMENT_STATUS,
  COOLIFY_OPERATION_KIND,
  COOLIFY_OPERATION_STATE,
  COOLIFY_OPERATOR_SURFACE,
  COOLIFY_PRODUCTION_OWNER,
  COOLIFY_SCHEMA_EVIDENCE,
  COOLIFY_SECRET_ISOLATION_MODE,
  DEPLOYMENT_CAPACITY_STATUS,
  DEPLOYMENT_GATE_OUTCOME,
  DISCOVERY_MODE,
  DISK_CAPACITY_STAGE,
  EDGE_ROUTE_MODE,
  FINGERPRINT_PROOF_LEVEL,
  INODE_CAPACITY_STAGE,
  LEGACY_QUIESCENCE_MODE,
  LEGACY_RUNTIME_STATE,
  MANAGED_HANDOVER_STATE,
  MANAGED_PROJECT_RUNTIME_STATE,
  SECRET_BACKUP_OPERATION,
  SECRET_PROVISIONING_STATE,
  STEEL_SERVING_TARGET,
} from "./deployment-vocabulary-values.js"

function enumMembers(vocabulary: Readonly<Record<string, string>>): readonly string[] {
  return Object.freeze(Object.values(vocabulary))
}

export const OVERLAY_ENUM_VOCABULARY = {
  ManagedProjectRuntimeState: enumMembers(MANAGED_PROJECT_RUNTIME_STATE),
  LegacyRuntimeState: enumMembers(LEGACY_RUNTIME_STATE),
  DeploymentCapacityStatus: enumMembers(DEPLOYMENT_CAPACITY_STATUS),
  CapacityGateOutcome: enumMembers(CAPACITY_GATE_OUTCOME),
  DeploymentGateOutcome: enumMembers(DEPLOYMENT_GATE_OUTCOME),
  CoolifyCutoverMode: enumMembers(COOLIFY_CUTOVER_MODE),
  CoolifyOperatorSurface: enumMembers(COOLIFY_OPERATOR_SURFACE),
  CoolifyComposeDeploymentMode: enumMembers(COOLIFY_COMPOSE_DEPLOYMENT_MODE),
  CoolifySecretIsolationMode: enumMembers(COOLIFY_SECRET_ISOLATION_MODE),
  LegacyQuiescenceMode: enumMembers(LEGACY_QUIESCENCE_MODE),
  EdgeRouteMode: enumMembers(EDGE_ROUTE_MODE),
  CoolifyProductionOwner: enumMembers(COOLIFY_PRODUCTION_OWNER),
  SteelServingTarget: enumMembers(STEEL_SERVING_TARGET),
  CompositeRoutePhase: enumMembers(COMPOSITE_ROUTE_PHASE),
  FingerprintProofLevel: enumMembers(FINGERPRINT_PROOF_LEVEL),
  CoolifySchemaEvidence: enumMembers(COOLIFY_SCHEMA_EVIDENCE),
  SecretBackupOperation: enumMembers(SECRET_BACKUP_OPERATION),
  CoolifyOperationKind: enumMembers(COOLIFY_OPERATION_KIND),
  CoolifyDeploymentStatus: enumMembers(COOLIFY_DEPLOYMENT_STATUS),
  CoolifyOperationState: enumMembers(COOLIFY_OPERATION_STATE),
  SecretProvisioningState: enumMembers(SECRET_PROVISIONING_STATE),
  ManagedHandoverState: enumMembers(MANAGED_HANDOVER_STATE),
} as const satisfies Readonly<Record<string, readonly string[]>>

export const CAPACITY_ENUM_VOCABULARY = {
  CapacityPhase: enumMembers(CAPACITY_PHASE),
  DiskCapacityStage: enumMembers(DISK_CAPACITY_STAGE),
  InodeCapacityStage: enumMembers(INODE_CAPACITY_STAGE),
} as const satisfies Readonly<Record<string, readonly string[]>>

export const CLOSED_STATE_MEMBERS = Object.freeze(Array.from(
  new Set([
    ...Object.values(DISCOVERY_MODE),
    ...Object.values(OVERLAY_ENUM_VOCABULARY).flat(),
    ...Object.values(CAPACITY_ENUM_VOCABULARY).flat(),
    ...Object.values(LISTENER_ENUM_VOCABULARY).flat(),
  ]),
).sort())
