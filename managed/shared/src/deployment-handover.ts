import { z } from "zod"

import { withDeepReadonlyOutput, type DeepReadonly } from "./deep-readonly.js"
import {
  MANAGED_ACTIVE_LISTENER_INVENTORY,
  STOPPED_MANAGED_LISTENER_INVENTORY,
  ManagedActiveListenerInventorySchema,
  StoppedManagedListenerInventorySchema,
} from "./deployment-listener.js"
import { MANAGED_DEPLOYMENT_CONFIG } from "./deployment-topology.js"
import {
  DEPLOYMENT_CAPACITY_STATUS,
  MANAGED_HANDOVER_STATE,
  type ManagedHandoverState,
} from "./deployment-vocabulary.js"
import {
  DeploymentCapacityStatusSchema,
  ManagedHandoverStateSchema,
} from "./deployment-vocabulary-schemas.js"

const RunningProjectRuntimeProofSchema = z
  .object({
    projectRunning: z.literal(true),
    containerCount: z.literal(MANAGED_DEPLOYMENT_CONFIG.activeContainerCount),
    listenerCount: z.literal(MANAGED_DEPLOYMENT_CONFIG.activeListenerCount),
    listeners: ManagedActiveListenerInventorySchema,
    connectionCount: z.number().int().safe().nonnegative(),
  })
  .strict()

const StoppedProjectRuntimeProofSchema = z
  .object({
    projectRunning: z.literal(false),
    containerCount: z.literal(0),
    listenerCount: z.literal(0),
    listeners: StoppedManagedListenerInventorySchema,
    connectionCount: z.literal(0),
  })
  .strict()

const HandoverProjectRuntimeProofBaseSchema = z.discriminatedUnion("projectRunning", [
  RunningProjectRuntimeProofSchema,
  StoppedProjectRuntimeProofSchema,
])
export const HandoverProjectRuntimeProofSchema = withDeepReadonlyOutput(
  HandoverProjectRuntimeProofBaseSchema,
)

export type HandoverProjectRuntimeProof = z.infer<typeof HandoverProjectRuntimeProofSchema>

type HandoverRuntime = DeepReadonly<{
  readonly activeProjectRuntime: HandoverProjectRuntimeProof
  readonly standbyProjectRuntime: HandoverProjectRuntimeProof
}>

const RUNNING_PROJECT_RUNTIME_PROOF = {
  projectRunning: true,
  containerCount: MANAGED_DEPLOYMENT_CONFIG.activeContainerCount,
  listenerCount: MANAGED_DEPLOYMENT_CONFIG.activeListenerCount,
  listeners: MANAGED_ACTIVE_LISTENER_INVENTORY,
  connectionCount: 0,
} as const satisfies HandoverProjectRuntimeProof

const STOPPED_PROJECT_RUNTIME_PROOF = {
  projectRunning: false,
  containerCount: 0,
  listenerCount: 0,
  listeners: STOPPED_MANAGED_LISTENER_INVENTORY,
  connectionCount: 0,
} as const satisfies HandoverProjectRuntimeProof

export const MANAGED_HANDOVER_SEQUENCE = [
  MANAGED_HANDOVER_STATE.ACTIVE_DRAIN_SAFE,
  MANAGED_HANDOVER_STATE.EDGE_MAINTENANCE,
  MANAGED_HANDOVER_STATE.ACTIVE_STOPPED,
  MANAGED_HANDOVER_STATE.DOMAIN_NONE,
  MANAGED_HANDOVER_STATE.STANDBY_CONFIG_BOUND,
  MANAGED_HANDOVER_STATE.STANDBY_STARTED,
  MANAGED_HANDOVER_STATE.STANDBY_RUNTIME_VERIFIED,
  MANAGED_HANDOVER_STATE.DOMAIN_STANDBY,
  MANAGED_HANDOVER_STATE.STANDBY_SERVING,
  MANAGED_HANDOVER_STATE.EDGE_COOLIFY_PROXY,
] as const satisfies readonly ManagedHandoverState[]

export const HANDOVER_RUNTIME_BY_STATE = {
  [MANAGED_HANDOVER_STATE.ACTIVE_DRAIN_SAFE]: {
    activeProjectRuntime: RUNNING_PROJECT_RUNTIME_PROOF,
    standbyProjectRuntime: STOPPED_PROJECT_RUNTIME_PROOF,
  },
  [MANAGED_HANDOVER_STATE.EDGE_MAINTENANCE]: {
    activeProjectRuntime: RUNNING_PROJECT_RUNTIME_PROOF,
    standbyProjectRuntime: STOPPED_PROJECT_RUNTIME_PROOF,
  },
  [MANAGED_HANDOVER_STATE.ACTIVE_STOPPED]: {
    activeProjectRuntime: STOPPED_PROJECT_RUNTIME_PROOF,
    standbyProjectRuntime: STOPPED_PROJECT_RUNTIME_PROOF,
  },
  [MANAGED_HANDOVER_STATE.DOMAIN_NONE]: {
    activeProjectRuntime: STOPPED_PROJECT_RUNTIME_PROOF,
    standbyProjectRuntime: STOPPED_PROJECT_RUNTIME_PROOF,
  },
  [MANAGED_HANDOVER_STATE.STANDBY_CONFIG_BOUND]: {
    activeProjectRuntime: STOPPED_PROJECT_RUNTIME_PROOF,
    standbyProjectRuntime: STOPPED_PROJECT_RUNTIME_PROOF,
  },
  [MANAGED_HANDOVER_STATE.STANDBY_STARTED]: {
    activeProjectRuntime: STOPPED_PROJECT_RUNTIME_PROOF,
    standbyProjectRuntime: RUNNING_PROJECT_RUNTIME_PROOF,
  },
  [MANAGED_HANDOVER_STATE.STANDBY_RUNTIME_VERIFIED]: {
    activeProjectRuntime: STOPPED_PROJECT_RUNTIME_PROOF,
    standbyProjectRuntime: RUNNING_PROJECT_RUNTIME_PROOF,
  },
  [MANAGED_HANDOVER_STATE.DOMAIN_STANDBY]: {
    activeProjectRuntime: STOPPED_PROJECT_RUNTIME_PROOF,
    standbyProjectRuntime: RUNNING_PROJECT_RUNTIME_PROOF,
  },
  [MANAGED_HANDOVER_STATE.STANDBY_SERVING]: {
    activeProjectRuntime: STOPPED_PROJECT_RUNTIME_PROOF,
    standbyProjectRuntime: RUNNING_PROJECT_RUNTIME_PROOF,
  },
  [MANAGED_HANDOVER_STATE.EDGE_COOLIFY_PROXY]: {
    activeProjectRuntime: STOPPED_PROJECT_RUNTIME_PROOF,
    standbyProjectRuntime: RUNNING_PROJECT_RUNTIME_PROOF,
  },
} as const satisfies Readonly<Record<ManagedHandoverState, HandoverRuntime>>

const NEXT_HANDOVER_STATE = {
  [MANAGED_HANDOVER_STATE.ACTIVE_DRAIN_SAFE]: MANAGED_HANDOVER_STATE.EDGE_MAINTENANCE,
  [MANAGED_HANDOVER_STATE.EDGE_MAINTENANCE]: MANAGED_HANDOVER_STATE.ACTIVE_STOPPED,
  [MANAGED_HANDOVER_STATE.ACTIVE_STOPPED]: MANAGED_HANDOVER_STATE.DOMAIN_NONE,
  [MANAGED_HANDOVER_STATE.DOMAIN_NONE]: MANAGED_HANDOVER_STATE.STANDBY_CONFIG_BOUND,
  [MANAGED_HANDOVER_STATE.STANDBY_CONFIG_BOUND]: MANAGED_HANDOVER_STATE.STANDBY_STARTED,
  [MANAGED_HANDOVER_STATE.STANDBY_STARTED]: MANAGED_HANDOVER_STATE.STANDBY_RUNTIME_VERIFIED,
  [MANAGED_HANDOVER_STATE.STANDBY_RUNTIME_VERIFIED]: MANAGED_HANDOVER_STATE.DOMAIN_STANDBY,
  [MANAGED_HANDOVER_STATE.DOMAIN_STANDBY]: MANAGED_HANDOVER_STATE.STANDBY_SERVING,
  [MANAGED_HANDOVER_STATE.STANDBY_SERVING]: MANAGED_HANDOVER_STATE.EDGE_COOLIFY_PROXY,
  [MANAGED_HANDOVER_STATE.EDGE_COOLIFY_PROXY]: null,
} as const satisfies Readonly<Record<ManagedHandoverState, ManagedHandoverState | null>>

function matchesExpectedRuntime(
  observed: HandoverProjectRuntimeProof,
  expected: HandoverProjectRuntimeProof,
): boolean {
  return (
    observed.projectRunning === expected.projectRunning &&
    observed.containerCount === expected.containerCount &&
    observed.listenerCount === expected.listenerCount &&
    observed.connectionCount === expected.connectionCount
  )
}

const HandoverTransitionBaseSchema = z
  .object({
    from: ManagedHandoverStateSchema,
    to: ManagedHandoverStateSchema,
    activeProjectRuntime: HandoverProjectRuntimeProofSchema,
    standbyProjectRuntime: HandoverProjectRuntimeProofSchema,
    capacityStatus: DeploymentCapacityStatusSchema,
  })
  .strict()
  .superRefine((transition, context) => {
    const expectedNext = NEXT_HANDOVER_STATE[transition.from]
    const expectedRuntime = HANDOVER_RUNTIME_BY_STATE[transition.to]
    if (expectedNext === null || transition.to !== expectedNext) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "handover transition is not adjacent" })
    }
    if (
      !matchesExpectedRuntime(transition.activeProjectRuntime, expectedRuntime.activeProjectRuntime) ||
      !matchesExpectedRuntime(transition.standbyProjectRuntime, expectedRuntime.standbyProjectRuntime)
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "handover runtime does not match target state" })
    }
    if (
      transition.activeProjectRuntime.projectRunning &&
      transition.standbyProjectRuntime.projectRunning
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "managed project runtime overlap is forbidden" })
    }
    if (transition.capacityStatus !== DEPLOYMENT_CAPACITY_STATUS.VERIFIED) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "cutover capacity must be verified" })
    }
  })
export const HandoverTransitionSchema = withDeepReadonlyOutput(HandoverTransitionBaseSchema)

export type HandoverTransition = z.infer<typeof HandoverTransitionSchema>
