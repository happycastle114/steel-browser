import { z } from "zod"

import type { DeepReadonly } from "./deep-readonly.js"
import {
  CAPACITY_GATE_OUTCOME,
  COOLIFY_DEPLOYMENT_STATUS,
  COOLIFY_OPERATION_STATE,
  DEPLOYMENT_CAPACITY_STATUS,
  DEPLOYMENT_GATE_OUTCOME,
  FINGERPRINT_PROOF_LEVEL,
} from "./deployment-vocabulary.js"
import { DeploymentCapacityStatusSchema } from "./deployment-vocabulary-schemas.js"

export const StartupGateSchema = z.object({ capacityStatus: DeploymentCapacityStatusSchema }).strict()

export const DEPLOYMENT_GATE_RESULT = {
  VERIFIED: { outcome: DEPLOYMENT_GATE_OUTCOME.VERIFIED },
  BLOCKED_COOLIFY_CAPACITY: { outcome: DEPLOYMENT_GATE_OUTCOME.BLOCKED_COOLIFY_CAPACITY },
  BLOCKED_SECRET_RUNTIME: { outcome: DEPLOYMENT_GATE_OUTCOME.BLOCKED_SECRET_RUNTIME },
  BLOCKED_NO_SAFE_TARGET: { outcome: DEPLOYMENT_GATE_OUTCOME.BLOCKED_NO_SAFE_TARGET },
  BLOCKED_COOLIFY_OPERATION: { outcome: DEPLOYMENT_GATE_OUTCOME.BLOCKED_COOLIFY_OPERATION },
  BLOCKED_ROUTE_OWNERSHIP: { outcome: DEPLOYMENT_GATE_OUTCOME.BLOCKED_ROUTE_OWNERSHIP },
} as const

export const DeploymentGateResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal(DEPLOYMENT_GATE_OUTCOME.VERIFIED) }).strict(),
  z.object({ outcome: z.literal(DEPLOYMENT_GATE_OUTCOME.BLOCKED_COOLIFY_CAPACITY) }).strict(),
  z.object({ outcome: z.literal(DEPLOYMENT_GATE_OUTCOME.BLOCKED_SECRET_RUNTIME) }).strict(),
  z.object({ outcome: z.literal(DEPLOYMENT_GATE_OUTCOME.BLOCKED_NO_SAFE_TARGET) }).strict(),
  z.object({ outcome: z.literal(DEPLOYMENT_GATE_OUTCOME.BLOCKED_COOLIFY_OPERATION) }).strict(),
  z.object({ outcome: z.literal(DEPLOYMENT_GATE_OUTCOME.BLOCKED_ROUTE_OWNERSHIP) }).strict(),
])

export const CutoverGateSchema = z
  .object({
    capacityStatus: z.literal(DEPLOYMENT_CAPACITY_STATUS.VERIFIED),
    capacityGateOutcome: z.literal(CAPACITY_GATE_OUTCOME.VERIFIED),
    deploymentGateOutcome: z.literal(DEPLOYMENT_GATE_OUTCOME.VERIFIED),
    fingerprintProofLevel: z.literal(FINGERPRINT_PROOF_LEVEL.RUNTIME_VERIFIED),
    operationState: z.literal(COOLIFY_OPERATION_STATE.TERMINAL_SUCCESS),
    deploymentStatus: z.literal(COOLIFY_DEPLOYMENT_STATUS.FINISHED),
  })
  .strict()

export type CutoverGate = DeepReadonly<z.infer<typeof CutoverGateSchema>>
export type DeploymentGateResult = DeepReadonly<z.infer<typeof DeploymentGateResultSchema>>
