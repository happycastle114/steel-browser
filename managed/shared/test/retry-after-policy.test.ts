import { describe, expect, it } from "vitest"

import { MANAGED_ERROR_CODE } from "../src/error-contract.js"
import {
  AI_RESULT_CAPACITY_STATE,
  RETRY_POLICY_CAUSE,
  RetryMetadataSchema,
  retryMetadataFor,
} from "../src/retry-after.js"

describe("closed managed retry metadata policy", () => {
  it.each([
    [{ cause: RETRY_POLICY_CAUSE.TOKEN_BUCKET, nowMs: 1_000, resetAtMs: 3_001 }, 3, MANAGED_ERROR_CODE.RATE_LIMITED],
    [{ cause: RETRY_POLICY_CAUSE.QUEUE_FULL, reconcileMs: 5_000 }, 5, MANAGED_ERROR_CODE.QUEUE_FULL],
    [{ cause: RETRY_POLICY_CAUSE.TICKET_CAPACITY, reconcileMs: 5_000 }, 5, MANAGED_ERROR_CODE.MANAGED_TICKET_CAPACITY],
    [{ cause: RETRY_POLICY_CAUSE.SYNC_NONTERMINAL_TIMEOUT, reconcileMs: 5_000 }, 5, MANAGED_ERROR_CODE.ADMISSION_TIMEOUT],
    [{ cause: RETRY_POLICY_CAUSE.NO_REACHABLE_WORKER, reconcileMs: 5_000 }, 5, MANAGED_ERROR_CODE.NO_REACHABLE_WORKER],
    [{ cause: RETRY_POLICY_CAUSE.INGRESS_CAPACITY, reconcileMs: 5_000 }, 5, MANAGED_ERROR_CODE.MANAGED_INGRESS_CAPACITY],
    [{ cause: RETRY_POLICY_CAUSE.ACTION_CAPACITY, reconcileMs: 5_000 }, 5, MANAGED_ERROR_CODE.MANAGED_ACTION_CAPACITY],
    [{ cause: RETRY_POLICY_CAUSE.WEBSOCKET_CAPACITY, reconcileMs: 5_000 }, 5, MANAGED_ERROR_CODE.MANAGED_WS_CAPACITY],
    [{ cause: RETRY_POLICY_CAUSE.EXPIRED_TERMINAL, nowMs: 1_000, expiresAtMs: 1_001 }, 1, MANAGED_ERROR_CODE.ADMISSION_TIMEOUT],
    [{ cause: RETRY_POLICY_CAUSE.SUBJECT_CAPACITY }, 60, MANAGED_ERROR_CODE.MANAGED_LIMITER_CAPACITY],
    [{ cause: RETRY_POLICY_CAUSE.IDEMPOTENCY_CAPACITY }, 60, MANAGED_ERROR_CODE.MANAGED_IDEMPOTENCY_CAPACITY],
    [{ cause: RETRY_POLICY_CAUSE.MANAGER_DRAINING }, 60, MANAGED_ERROR_CODE.MANAGER_DRAINING],
    [{ cause: RETRY_POLICY_CAUSE.SNAPSHOT_CAPACITY }, 1, MANAGED_ERROR_CODE.MANAGED_SNAPSHOT_CAPACITY],
  ] as const)("maps closed retry cause %#", (input, expected, expectedCode) => {
    // Given: one closed retry cause and its required clock input.
    // When: HTTP and error-detail metadata are generated together.
    const metadata = retryMetadataFor(input)
    // Then: both representations contain the same exact positive integer.
    expect(metadata).toMatchObject({
      retryAfterSeconds: expected,
      headers: { "Retry-After": String(expected) },
      details: { retryAfterSeconds: expected },
    })
    expect(metadata.errorCode).toBe(expectedCode)
  })

  it.each([
    [{
      cause: RETRY_POLICY_CAUSE.AI_RESULT_CAPACITY,
      state: AI_RESULT_CAPACITY_STATE.IN_FLIGHT_CONTRIBUTES,
      reconcileMs: 5_000,
    }, 5],
    [{
      cause: RETRY_POLICY_CAUSE.AI_RESULT_CAPACITY,
      state: AI_RESULT_CAPACITY_STATE.RETAINED_ONLY,
      nowMs: 1_000,
      earliestRetainedExpiresAtMs: 3_001,
    }, 3],
  ] as const)("maps AI result exhaustion row %#", (input, expected) => {
    // Given: one of the only two representable result-capacity exhaustion states.
    // When: the retry metadata is generated.
    const metadata = retryMetadataFor(input)
    // Then: in-flight uses reconcile while retained-only uses earliest expiry.
    expect(metadata.retryAfterSeconds).toBe(expected)
    expect(metadata.errorCode).toBe(MANAGED_ERROR_CODE.MANAGED_AI_RESULT_CAPACITY)
    expect(metadata.headers["Retry-After"]).toBe(String(metadata.details.retryAfterSeconds))
  })

  it("rejects mismatched Retry-After header and error details", () => {
    // Given: retry metadata whose header differs from its structured error detail.
    const input = {
      errorCode: MANAGED_ERROR_CODE.QUEUE_FULL,
      retryAfterSeconds: 5,
      headers: { "Retry-After": "4" },
      details: { retryAfterSeconds: 5 },
    }
    // When: the shared retry boundary parses it.
    const result = RetryMetadataSchema.safeParse(input)
    // Then: adapters cannot emit divergent header and body clocks.
    expect(result.success).toBe(false)
  })
})
