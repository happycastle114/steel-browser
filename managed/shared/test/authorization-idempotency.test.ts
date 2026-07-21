import { describe, expect, it } from "vitest"

import {
  AUTHORIZATION_ACCESS,
  AUTHORIZATION_MATRIX,
  AUTHORIZATION_OPERATION,
  authorizationAccess,
} from "../src/authorization-policy.js"
import {
  CREATE_REPLAY_POLICY,
  CREATE_REPLAY_SURFACE,
  REPLAY_RESPONSE_KIND,
  mapJournalStateToReplayState,
  replayPolicyFor,
} from "../src/idempotency-policy.js"
import {
  CREATE_JOURNAL_STATE,
  CREATE_REPLAY_STATE,
  IDEMPOTENCY_SCOPE,
  PRINCIPAL_ROLE,
} from "../src/control-plane-vocabulary.js"

describe("closed authorization matrix", () => {
  it("contains one USER and OPERATOR row for every operation", () => {
    // Given: the complete authorization operation vocabulary.
    const operations = Object.values(AUTHORIZATION_OPERATION)
    // When: matrix coverage is inspected.
    const covered = operations.map((operation) => Object.keys(AUTHORIZATION_MATRIX[operation]).sort())
    // Then: both roles have an explicit decision with no fallback.
    expect(covered).toEqual(
      operations.map(() => [PRINCIPAL_ROLE.OPERATOR, PRINCIPAL_ROLE.USER].sort()),
    )
  })

  it.each([
    [PRINCIPAL_ROLE.USER, AUTHORIZATION_OPERATION.POOL_SUMMARY, AUTHORIZATION_ACCESS.GLOBAL],
    [PRINCIPAL_ROLE.USER, AUTHORIZATION_OPERATION.SESSION_DETAIL, AUTHORIZATION_ACCESS.OWN],
    [PRINCIPAL_ROLE.OPERATOR, AUTHORIZATION_OPERATION.SESSION_DETAIL, AUTHORIZATION_ACCESS.ANY_OWNER],
    [PRINCIPAL_ROLE.USER, AUTHORIZATION_OPERATION.WORKER_INVENTORY, AUTHORIZATION_ACCESS.DENY],
    [PRINCIPAL_ROLE.OPERATOR, AUTHORIZATION_OPERATION.WORKER_INVENTORY, AUTHORIZATION_ACCESS.GLOBAL],
    [PRINCIPAL_ROLE.OPERATOR, AUTHORIZATION_OPERATION.RESULT_DOWNLOAD, AUTHORIZATION_ACCESS.CREATOR],
  ] as const)("returns exact authorization row %#", (role, operation, expected) => {
    // Given: an authenticated role and declared operation.
    // When: the matrix is queried.
    const access = authorizationAccess(role, operation)
    // Then: the exact ownership/global rule is returned.
    expect(access).toBe(expected)
  })
})

describe("principal-scoped create replay matrix", () => {
  it("fixes idempotency namespace to validated principal", () => {
    // Given: the canonical idempotency policy.
    // When: its namespace is read.
    const scope = IDEMPOTENCY_SCOPE.PRINCIPAL
    // Then: keys never become global across principals.
    expect(scope).toBe("PRINCIPAL")
  })

  it("contains every replay state on every keyed surface", () => {
    // Given: all domain replay states and surfaces.
    const states = Object.values(CREATE_REPLAY_STATE)
    const surfaces = Object.values(CREATE_REPLAY_SURFACE)
    // When: matrix cells are enumerated.
    const cells = states.flatMap((state) => surfaces.map((surface) => CREATE_REPLAY_POLICY[state][surface]))
    // Then: every cell is explicitly defined.
    expect(cells).toHaveLength(states.length * surfaces.length)
    expect(cells.every((cell) => cell !== undefined)).toBe(true)
  })

  it.each([
    [CREATE_REPLAY_STATE.QUEUED, CREATE_REPLAY_SURFACE.MANAGED, REPLAY_RESPONSE_KIND.ADMISSION, 202, true],
    [CREATE_REPLAY_STATE.WORKER_PENDING, CREATE_REPLAY_SURFACE.COMPATIBILITY, REPLAY_RESPONSE_KIND.ERROR, 429, true],
    [CREATE_REPLAY_STATE.LIVE, CREATE_REPLAY_SURFACE.AI_REST, REPLAY_RESPONSE_KIND.SESSION, 200, false],
    [CREATE_REPLAY_STATE.LIVE, CREATE_REPLAY_SURFACE.MCP, REPLAY_RESPONSE_KIND.SESSION, 200, false],
    [CREATE_REPLAY_STATE.CANCELLED_TERMINAL, CREATE_REPLAY_SURFACE.MANAGED, REPLAY_RESPONSE_KIND.ERROR, 409, false],
    [CREATE_REPLAY_STATE.EXPIRED_TERMINAL, CREATE_REPLAY_SURFACE.AI_REST, REPLAY_RESPONSE_KIND.ERROR, 429, true],
    [CREATE_REPLAY_STATE.RELEASED_TERMINAL, CREATE_REPLAY_SURFACE.MCP, REPLAY_RESPONSE_KIND.ERROR, 200, false],
    [CREATE_REPLAY_STATE.FAILED_TERMINAL, CREATE_REPLAY_SURFACE.COMPATIBILITY, REPLAY_RESPONSE_KIND.ORIGINAL_ERROR, 0, false],
  ] as const)("returns exact replay adapter row %#", (state, surface, kind, status, retryAfter) => {
    // Given: one domain record and external surface.
    // When: the adapter policy is selected.
    const policy = replayPolicyFor(state, surface)
    // Then: response kind/status/retry metadata match the canonical table.
    expect(policy).toMatchObject({ kind, httpStatus: status, retryAfter })
  })

  it.each([
    [CREATE_JOURNAL_STATE.ACCEPTED, CREATE_REPLAY_STATE.WORKER_PENDING],
    [CREATE_JOURNAL_STATE.UPSTREAM_PENDING, CREATE_REPLAY_STATE.WORKER_PENDING],
    [CREATE_JOURNAL_STATE.UNCERTAIN, CREATE_REPLAY_STATE.WORKER_PENDING],
    [CREATE_JOURNAL_STATE.LIVE, CREATE_REPLAY_STATE.LIVE],
    [CREATE_JOURNAL_STATE.RELEASED_TERMINAL, CREATE_REPLAY_STATE.RELEASED_TERMINAL],
    [CREATE_JOURNAL_STATE.FAILED_TERMINAL, CREATE_REPLAY_STATE.FAILED_TERMINAL],
  ] as const)("projects journal state into replay state %#", (journalState, expected) => {
    // Given: an observed worker journal state.
    // When: it is projected into the manager replay domain.
    const state = mapJournalStateToReplayState(journalState)
    // Then: pending and terminal meanings are preserved exactly.
    expect(state).toBe(expected)
  })
})
