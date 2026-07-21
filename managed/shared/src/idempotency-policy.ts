import {
  CREATE_JOURNAL_STATE,
  CREATE_REPLAY_STATE,
  type CreateJournalState,
  type CreateReplayState,
} from "./control-plane-vocabulary.js"

export const CREATE_REPLAY_SURFACE = {
  MANAGED: "MANAGED",
  AI_REST: "AI_REST",
  MCP: "MCP",
  COMPATIBILITY: "COMPATIBILITY",
} as const
export type CreateReplaySurface = (typeof CREATE_REPLAY_SURFACE)[keyof typeof CREATE_REPLAY_SURFACE]

export const REPLAY_RESPONSE_KIND = {
  ADMISSION: "ADMISSION",
  SESSION: "SESSION",
  ERROR: "ERROR",
  ORIGINAL_SUCCESS: "ORIGINAL_SUCCESS",
  ORIGINAL_ERROR: "ORIGINAL_ERROR",
} as const
export type ReplayResponseKind = (typeof REPLAY_RESPONSE_KIND)[keyof typeof REPLAY_RESPONSE_KIND]

export type CreateReplayPolicy = Readonly<{
  readonly kind: ReplayResponseKind
  readonly httpStatus: number
  readonly retryAfter: boolean
  readonly mutates: false
}>
type SurfacePolicy = Readonly<Record<CreateReplaySurface, CreateReplayPolicy>>

const policy = (kind: ReplayResponseKind, httpStatus: number, retryAfter = false): CreateReplayPolicy => ({
  kind,
  httpStatus,
  retryAfter,
  mutates: false,
})

const nonterminal = {
  [CREATE_REPLAY_SURFACE.MANAGED]: policy(REPLAY_RESPONSE_KIND.ADMISSION, 202, true),
  [CREATE_REPLAY_SURFACE.AI_REST]: policy(REPLAY_RESPONSE_KIND.ADMISSION, 202, true),
  [CREATE_REPLAY_SURFACE.MCP]: policy(REPLAY_RESPONSE_KIND.ADMISSION, 200),
  [CREATE_REPLAY_SURFACE.COMPATIBILITY]: policy(REPLAY_RESPONSE_KIND.ERROR, 429, true),
} as const satisfies SurfacePolicy
const live = {
  [CREATE_REPLAY_SURFACE.MANAGED]: policy(REPLAY_RESPONSE_KIND.ADMISSION, 202),
  [CREATE_REPLAY_SURFACE.AI_REST]: policy(REPLAY_RESPONSE_KIND.SESSION, 200),
  [CREATE_REPLAY_SURFACE.MCP]: policy(REPLAY_RESPONSE_KIND.SESSION, 200),
  [CREATE_REPLAY_SURFACE.COMPATIBILITY]: policy(REPLAY_RESPONSE_KIND.ORIGINAL_SUCCESS, 0),
} as const satisfies SurfacePolicy
const cancelled = {
  [CREATE_REPLAY_SURFACE.MANAGED]: policy(REPLAY_RESPONSE_KIND.ERROR, 409),
  [CREATE_REPLAY_SURFACE.AI_REST]: policy(REPLAY_RESPONSE_KIND.ERROR, 409),
  [CREATE_REPLAY_SURFACE.MCP]: policy(REPLAY_RESPONSE_KIND.ERROR, 200),
  [CREATE_REPLAY_SURFACE.COMPATIBILITY]: policy(REPLAY_RESPONSE_KIND.ERROR, 409),
} as const satisfies SurfacePolicy
const expired = {
  [CREATE_REPLAY_SURFACE.MANAGED]: policy(REPLAY_RESPONSE_KIND.ERROR, 429, true),
  [CREATE_REPLAY_SURFACE.AI_REST]: policy(REPLAY_RESPONSE_KIND.ERROR, 429, true),
  [CREATE_REPLAY_SURFACE.MCP]: policy(REPLAY_RESPONSE_KIND.ERROR, 200),
  [CREATE_REPLAY_SURFACE.COMPATIBILITY]: policy(REPLAY_RESPONSE_KIND.ERROR, 429, true),
} as const satisfies SurfacePolicy
const released = {
  [CREATE_REPLAY_SURFACE.MANAGED]: policy(REPLAY_RESPONSE_KIND.ERROR, 409),
  [CREATE_REPLAY_SURFACE.AI_REST]: policy(REPLAY_RESPONSE_KIND.ERROR, 409),
  [CREATE_REPLAY_SURFACE.MCP]: policy(REPLAY_RESPONSE_KIND.ERROR, 200),
  [CREATE_REPLAY_SURFACE.COMPATIBILITY]: policy(REPLAY_RESPONSE_KIND.ERROR, 409),
} as const satisfies SurfacePolicy
const failed = {
  [CREATE_REPLAY_SURFACE.MANAGED]: policy(REPLAY_RESPONSE_KIND.ORIGINAL_ERROR, 0),
  [CREATE_REPLAY_SURFACE.AI_REST]: policy(REPLAY_RESPONSE_KIND.ORIGINAL_ERROR, 0),
  [CREATE_REPLAY_SURFACE.MCP]: policy(REPLAY_RESPONSE_KIND.ORIGINAL_ERROR, 200),
  [CREATE_REPLAY_SURFACE.COMPATIBILITY]: policy(REPLAY_RESPONSE_KIND.ORIGINAL_ERROR, 0),
} as const satisfies SurfacePolicy

export const CREATE_REPLAY_POLICY = {
  [CREATE_REPLAY_STATE.QUEUED]: nonterminal,
  [CREATE_REPLAY_STATE.RESERVED]: nonterminal,
  [CREATE_REPLAY_STATE.STARTING]: nonterminal,
  [CREATE_REPLAY_STATE.WORKER_PENDING]: nonterminal,
  [CREATE_REPLAY_STATE.LIVE]: live,
  [CREATE_REPLAY_STATE.CANCELLED_TERMINAL]: cancelled,
  [CREATE_REPLAY_STATE.EXPIRED_TERMINAL]: expired,
  [CREATE_REPLAY_STATE.RELEASED_TERMINAL]: released,
  [CREATE_REPLAY_STATE.FAILED_TERMINAL]: failed,
} as const satisfies Readonly<Record<CreateReplayState, SurfacePolicy>>

export function replayPolicyFor(state: CreateReplayState, surface: CreateReplaySurface): CreateReplayPolicy {
  return CREATE_REPLAY_POLICY[state][surface]
}

export function mapJournalStateToReplayState(state: CreateJournalState): CreateReplayState {
  switch (state) {
    case CREATE_JOURNAL_STATE.ACCEPTED:
    case CREATE_JOURNAL_STATE.UPSTREAM_PENDING:
    case CREATE_JOURNAL_STATE.UNCERTAIN:
      return CREATE_REPLAY_STATE.WORKER_PENDING
    case CREATE_JOURNAL_STATE.LIVE:
      return CREATE_REPLAY_STATE.LIVE
    case CREATE_JOURNAL_STATE.RELEASED_TERMINAL:
      return CREATE_REPLAY_STATE.RELEASED_TERMINAL
    case CREATE_JOURNAL_STATE.FAILED_TERMINAL:
      return CREATE_REPLAY_STATE.FAILED_TERMINAL
  }
}
