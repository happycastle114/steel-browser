import { describe, expect, it } from "vitest"

import {
  CREATE_REPLAY_SURFACE,
  REPLAY_RESPONSE_KIND,
  replayPolicyFor,
  type CreateReplayPolicy,
  type CreateReplaySurface,
} from "../src/idempotency-policy.js"
import { CREATE_REPLAY_STATE, type CreateReplayState } from "../src/control-plane-vocabulary.js"

type Row = Readonly<Record<CreateReplaySurface, CreateReplayPolicy>>
const cell = (kind: CreateReplayPolicy["kind"], httpStatus: number, retryAfter = false): CreateReplayPolicy => ({
  kind,
  httpStatus,
  retryAfter,
  mutates: false,
})
const nonterminal: Row = {
  MANAGED: cell(REPLAY_RESPONSE_KIND.ADMISSION, 202, true),
  AI_REST: cell(REPLAY_RESPONSE_KIND.ADMISSION, 202, true),
  MCP: cell(REPLAY_RESPONSE_KIND.ADMISSION, 200),
  COMPATIBILITY: cell(REPLAY_RESPONSE_KIND.ERROR, 429, true),
}
const EXPECTED_REPLAY_POLICY: Readonly<Record<CreateReplayState, Row>> = {
  QUEUED: nonterminal,
  RESERVED: nonterminal,
  STARTING: nonterminal,
  WORKER_PENDING: nonterminal,
  LIVE: {
    MANAGED: cell(REPLAY_RESPONSE_KIND.ADMISSION, 202), AI_REST: cell(REPLAY_RESPONSE_KIND.SESSION, 200),
    MCP: cell(REPLAY_RESPONSE_KIND.SESSION, 200), COMPATIBILITY: cell(REPLAY_RESPONSE_KIND.ORIGINAL_SUCCESS, 0),
  },
  CANCELLED_TERMINAL: {
    MANAGED: cell(REPLAY_RESPONSE_KIND.ERROR, 409), AI_REST: cell(REPLAY_RESPONSE_KIND.ERROR, 409),
    MCP: cell(REPLAY_RESPONSE_KIND.ERROR, 200), COMPATIBILITY: cell(REPLAY_RESPONSE_KIND.ERROR, 409),
  },
  EXPIRED_TERMINAL: {
    MANAGED: cell(REPLAY_RESPONSE_KIND.ERROR, 429, true), AI_REST: cell(REPLAY_RESPONSE_KIND.ERROR, 429, true),
    MCP: cell(REPLAY_RESPONSE_KIND.ERROR, 200), COMPATIBILITY: cell(REPLAY_RESPONSE_KIND.ERROR, 429, true),
  },
  RELEASED_TERMINAL: {
    MANAGED: cell(REPLAY_RESPONSE_KIND.ERROR, 409), AI_REST: cell(REPLAY_RESPONSE_KIND.ERROR, 409),
    MCP: cell(REPLAY_RESPONSE_KIND.ERROR, 200), COMPATIBILITY: cell(REPLAY_RESPONSE_KIND.ERROR, 409),
  },
  FAILED_TERMINAL: {
    MANAGED: cell(REPLAY_RESPONSE_KIND.ORIGINAL_ERROR, 0), AI_REST: cell(REPLAY_RESPONSE_KIND.ORIGINAL_ERROR, 0),
    MCP: cell(REPLAY_RESPONSE_KIND.ORIGINAL_ERROR, 200), COMPATIBILITY: cell(REPLAY_RESPONSE_KIND.ORIGINAL_ERROR, 0),
  },
}

describe("independent create replay oracle", () => {
  it("asserts every state by every response surface", () => {
    // Given: all thirty-six state-surface expectations declared independently.
    const states = Object.values(CREATE_REPLAY_STATE)
    const surfaces = Object.values(CREATE_REPLAY_SURFACE)
    // When: every public policy cell is selected.
    const observed = states.flatMap((state) => surfaces.map((surface) => replayPolicyFor(state, surface)))
    // Then: response kind, status, retry behavior, and no-mutation flag all match.
    expect(observed).toEqual(states.flatMap((state) => surfaces.map((surface) => EXPECTED_REPLAY_POLICY[state][surface])))
  })

  it("keeps nonterminal AI REST replays accepted but incomplete", () => {
    // Given: a queued idempotent create replay over AI REST.
    // When: its adapter policy is resolved.
    const policy = replayPolicyFor(CREATE_REPLAY_STATE.QUEUED, CREATE_REPLAY_SURFACE.AI_REST)
    // Then: it remains a retryable 202 admission without mutation.
    expect(policy).toEqual(cell(REPLAY_RESPONSE_KIND.ADMISSION, 202, true))
  })
})
