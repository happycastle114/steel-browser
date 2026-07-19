import { z } from "zod"

export const WORKSPACE_PATH = {
  ABSENT: "ABSENT",
  PRESENT: "PRESENT",
} as const

export const GH_IDENTITY = {
  EXPECTED: "EXPECTED",
  OTHER: "OTHER",
} as const

export const FORK_RELATION = {
  ABSENT: "ABSENT",
  EXACT_PARENT: "EXACT_PARENT",
  UNRELATED: "UNRELATED",
} as const

export const MAIN_MIRROR = {
  CURRENT: "CURRENT",
  FAST_FORWARD_REQUIRED: "FAST_FORWARD_REQUIRED",
  NON_FAST_FORWARD: "NON_FAST_FORWARD",
} as const

export const BASE_REACHABILITY = {
  REACHABLE: "REACHABLE",
  MISSING: "MISSING",
} as const

export const MANAGED_BRANCH = {
  ABSENT: "ABSENT",
  COMPATIBLE: "COMPATIBLE",
  COLLISION: "COLLISION",
} as const

export const BOOTSTRAP_DECISION = {
  READY: "READY",
  BLOCKED: "BLOCKED",
} as const

export const BOOTSTRAP_ACTION = {
  CREATE_FORK_AND_MANAGED: "CREATE_FORK_AND_MANAGED",
  CREATE_MANAGED: "CREATE_MANAGED",
  USE_MANAGED: "USE_MANAGED",
  FAST_FORWARD_MAIN_CREATE_MANAGED: "FAST_FORWARD_MAIN_CREATE_MANAGED",
  FAST_FORWARD_MAIN_USE_MANAGED: "FAST_FORWARD_MAIN_USE_MANAGED",
} as const

export const BOOTSTRAP_BLOCK_CODE = {
  LOCAL_PATH_COLLISION: "LOCAL_PATH_COLLISION",
  IDENTITY_MISMATCH: "IDENTITY_MISMATCH",
  UNRELATED_FORK: "UNRELATED_FORK",
  NON_FAST_FORWARD_MIRROR: "NON_FAST_FORWARD_MIRROR",
  PINNED_BASE_MISSING: "PINNED_BASE_MISSING",
  REMOTE_COLLISION: "BLOCKED_REMOTE_COLLISION",
} as const

const ForkSchema = z.discriminatedUnion("relation", [
  z.object({ relation: z.literal(FORK_RELATION.ABSENT) }).strict(),
  z.object({ relation: z.literal(FORK_RELATION.UNRELATED) }).strict(),
  z
    .object({
      relation: z.literal(FORK_RELATION.EXACT_PARENT),
      mainMirror: z.enum([
        MAIN_MIRROR.CURRENT,
        MAIN_MIRROR.FAST_FORWARD_REQUIRED,
        MAIN_MIRROR.NON_FAST_FORWARD,
      ]),
      managedBranch: z.enum([
        MANAGED_BRANCH.ABSENT,
        MANAGED_BRANCH.COMPATIBLE,
        MANAGED_BRANCH.COLLISION,
      ]),
    })
    .strict(),
])

const BootstrapFactsSchema = z
  .object({
    workspacePath: z.enum([WORKSPACE_PATH.ABSENT, WORKSPACE_PATH.PRESENT]),
    identity: z.enum([GH_IDENTITY.EXPECTED, GH_IDENTITY.OTHER]),
    baseReachability: z.enum([BASE_REACHABILITY.REACHABLE, BASE_REACHABILITY.MISSING]),
    fork: ForkSchema,
  })
  .strict()

export type BootstrapFacts = Readonly<z.infer<typeof BootstrapFactsSchema>>

type BootstrapAction = (typeof BOOTSTRAP_ACTION)[keyof typeof BOOTSTRAP_ACTION]
type BootstrapBlockCode = (typeof BOOTSTRAP_BLOCK_CODE)[keyof typeof BOOTSTRAP_BLOCK_CODE]

export type BootstrapDecision =
  | { readonly kind: typeof BOOTSTRAP_DECISION.READY; readonly action: BootstrapAction }
  | { readonly kind: typeof BOOTSTRAP_DECISION.BLOCKED; readonly code: BootstrapBlockCode }

function assertNever(value: never): never {
  return value
}

function blocked(code: BootstrapBlockCode): BootstrapDecision {
  return { kind: BOOTSTRAP_DECISION.BLOCKED, code }
}

export function parseBootstrapFacts(input: unknown): BootstrapFacts {
  return BootstrapFactsSchema.parse(input)
}

export function decideBootstrap(facts: BootstrapFacts): BootstrapDecision {
  switch (facts.workspacePath) {
    case WORKSPACE_PATH.ABSENT:
      break
    case WORKSPACE_PATH.PRESENT:
      return blocked(BOOTSTRAP_BLOCK_CODE.LOCAL_PATH_COLLISION)
    default:
      return assertNever(facts.workspacePath)
  }

  switch (facts.identity) {
    case GH_IDENTITY.EXPECTED:
      break
    case GH_IDENTITY.OTHER:
      return blocked(BOOTSTRAP_BLOCK_CODE.IDENTITY_MISMATCH)
    default:
      return assertNever(facts.identity)
  }

  switch (facts.baseReachability) {
    case BASE_REACHABILITY.REACHABLE:
      break
    case BASE_REACHABILITY.MISSING:
      return blocked(BOOTSTRAP_BLOCK_CODE.PINNED_BASE_MISSING)
    default:
      return assertNever(facts.baseReachability)
  }

  const fork = facts.fork
  switch (fork.relation) {
    case FORK_RELATION.ABSENT:
      return {
        kind: BOOTSTRAP_DECISION.READY,
        action: BOOTSTRAP_ACTION.CREATE_FORK_AND_MANAGED,
      }
    case FORK_RELATION.UNRELATED:
      return blocked(BOOTSTRAP_BLOCK_CODE.UNRELATED_FORK)
    case FORK_RELATION.EXACT_PARENT:
      switch (fork.managedBranch) {
        case MANAGED_BRANCH.COLLISION:
          return blocked(BOOTSTRAP_BLOCK_CODE.REMOTE_COLLISION)
        case MANAGED_BRANCH.ABSENT:
          switch (fork.mainMirror) {
            case MAIN_MIRROR.CURRENT:
              return { kind: BOOTSTRAP_DECISION.READY, action: BOOTSTRAP_ACTION.CREATE_MANAGED }
            case MAIN_MIRROR.FAST_FORWARD_REQUIRED:
              return {
                kind: BOOTSTRAP_DECISION.READY,
                action: BOOTSTRAP_ACTION.FAST_FORWARD_MAIN_CREATE_MANAGED,
              }
            case MAIN_MIRROR.NON_FAST_FORWARD:
              return blocked(BOOTSTRAP_BLOCK_CODE.NON_FAST_FORWARD_MIRROR)
            default:
              return assertNever(fork.mainMirror)
          }
        case MANAGED_BRANCH.COMPATIBLE:
          switch (fork.mainMirror) {
            case MAIN_MIRROR.CURRENT:
              return { kind: BOOTSTRAP_DECISION.READY, action: BOOTSTRAP_ACTION.USE_MANAGED }
            case MAIN_MIRROR.FAST_FORWARD_REQUIRED:
              return {
                kind: BOOTSTRAP_DECISION.READY,
                action: BOOTSTRAP_ACTION.FAST_FORWARD_MAIN_USE_MANAGED,
              }
            case MAIN_MIRROR.NON_FAST_FORWARD:
              return blocked(BOOTSTRAP_BLOCK_CODE.NON_FAST_FORWARD_MIRROR)
            default:
              return assertNever(fork.mainMirror)
          }
        default:
          return assertNever(fork.managedBranch)
      }
    default:
      return assertNever(fork)
  }
}
