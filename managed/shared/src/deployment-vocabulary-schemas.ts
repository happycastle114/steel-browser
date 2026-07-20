import { z } from "zod"

import {
  CAPACITY_GATE_OUTCOME,
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
  EDGE_ROUTE_MODE,
  FINGERPRINT_PROOF_LEVEL,
  LEGACY_QUIESCENCE_MODE,
  LEGACY_RUNTIME_STATE,
  MANAGED_HANDOVER_STATE,
  MANAGED_PROJECT_RUNTIME_STATE,
  SECRET_BACKUP_OPERATION,
  SECRET_PROVISIONING_STATE,
  STEEL_SERVING_TARGET,
} from "./deployment-vocabulary.js"

export const ManagedProjectRuntimeStateSchema = z.nativeEnum(MANAGED_PROJECT_RUNTIME_STATE)
export const LegacyRuntimeStateSchema = z.nativeEnum(LEGACY_RUNTIME_STATE)
export const DeploymentCapacityStatusSchema = z.nativeEnum(DEPLOYMENT_CAPACITY_STATUS)
export const CapacityGateOutcomeSchema = z.nativeEnum(CAPACITY_GATE_OUTCOME)
export const DeploymentGateOutcomeSchema = z.nativeEnum(DEPLOYMENT_GATE_OUTCOME)
export const DiscoveryModeSchema = z.nativeEnum(DISCOVERY_MODE)
export const CoolifyCutoverModeSchema = z.nativeEnum(COOLIFY_CUTOVER_MODE)
export const CoolifyOperatorSurfaceSchema = z.nativeEnum(COOLIFY_OPERATOR_SURFACE)
export const CoolifyComposeDeploymentModeSchema = z.nativeEnum(COOLIFY_COMPOSE_DEPLOYMENT_MODE)
export const CoolifySecretIsolationModeSchema = z.nativeEnum(COOLIFY_SECRET_ISOLATION_MODE)
export const LegacyQuiescenceModeSchema = z.nativeEnum(LEGACY_QUIESCENCE_MODE)
export const EdgeRouteModeSchema = z.nativeEnum(EDGE_ROUTE_MODE)
export const CoolifyProductionOwnerSchema = z.nativeEnum(COOLIFY_PRODUCTION_OWNER)
export const SteelServingTargetSchema = z.nativeEnum(STEEL_SERVING_TARGET)
export const CompositeRoutePhaseSchema = z.nativeEnum(COMPOSITE_ROUTE_PHASE)
export const FingerprintProofLevelSchema = z.nativeEnum(FINGERPRINT_PROOF_LEVEL)
export const CoolifySchemaEvidenceSchema = z.nativeEnum(COOLIFY_SCHEMA_EVIDENCE)
export const SecretBackupOperationSchema = z.nativeEnum(SECRET_BACKUP_OPERATION)
export const CoolifyOperationKindSchema = z.nativeEnum(COOLIFY_OPERATION_KIND)
export const CoolifyDeploymentStatusSchema = z.nativeEnum(COOLIFY_DEPLOYMENT_STATUS)
export const CoolifyOperationStateSchema = z.nativeEnum(COOLIFY_OPERATION_STATE)
export const SecretProvisioningStateSchema = z.nativeEnum(SECRET_PROVISIONING_STATE)
export const ManagedHandoverStateSchema = z.nativeEnum(MANAGED_HANDOVER_STATE)
