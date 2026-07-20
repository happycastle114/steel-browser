import { z } from "zod"

import {
  DEPLOYMENT_CAPACITY_STATUS,
  MANAGED_HANDOVER_STATE,
  type ManagedHandoverState,
} from "./deployment-vocabulary.js"
import {
  DeploymentCapacityStatusSchema,
  ManagedHandoverStateSchema,
} from "./deployment-vocabulary-schemas.js"

type HandoverRuntime = Readonly<{
  readonly activeProjectRunning: boolean
  readonly standbyProjectRunning: boolean
}>

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
    activeProjectRunning: true,
    standbyProjectRunning: false,
  },
  [MANAGED_HANDOVER_STATE.EDGE_MAINTENANCE]: {
    activeProjectRunning: true,
    standbyProjectRunning: false,
  },
  [MANAGED_HANDOVER_STATE.ACTIVE_STOPPED]: {
    activeProjectRunning: false,
    standbyProjectRunning: false,
  },
  [MANAGED_HANDOVER_STATE.DOMAIN_NONE]: {
    activeProjectRunning: false,
    standbyProjectRunning: false,
  },
  [MANAGED_HANDOVER_STATE.STANDBY_CONFIG_BOUND]: {
    activeProjectRunning: false,
    standbyProjectRunning: false,
  },
  [MANAGED_HANDOVER_STATE.STANDBY_STARTED]: {
    activeProjectRunning: false,
    standbyProjectRunning: true,
  },
  [MANAGED_HANDOVER_STATE.STANDBY_RUNTIME_VERIFIED]: {
    activeProjectRunning: false,
    standbyProjectRunning: true,
  },
  [MANAGED_HANDOVER_STATE.DOMAIN_STANDBY]: {
    activeProjectRunning: false,
    standbyProjectRunning: true,
  },
  [MANAGED_HANDOVER_STATE.STANDBY_SERVING]: {
    activeProjectRunning: false,
    standbyProjectRunning: true,
  },
  [MANAGED_HANDOVER_STATE.EDGE_COOLIFY_PROXY]: {
    activeProjectRunning: false,
    standbyProjectRunning: true,
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

export const HandoverTransitionSchema = z
  .object({
    from: ManagedHandoverStateSchema,
    to: ManagedHandoverStateSchema,
    activeProjectRunning: z.boolean(),
    standbyProjectRunning: z.boolean(),
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
      transition.activeProjectRunning !== expectedRuntime.activeProjectRunning ||
      transition.standbyProjectRunning !== expectedRuntime.standbyProjectRunning
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "handover runtime does not match target state" })
    }
    if (transition.activeProjectRunning && transition.standbyProjectRunning) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "managed project runtime overlap is forbidden" })
    }
    if (transition.capacityStatus !== DEPLOYMENT_CAPACITY_STATUS.VERIFIED) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "cutover capacity must be verified" })
    }
  })

export type HandoverTransition = Readonly<z.infer<typeof HandoverTransitionSchema>>
