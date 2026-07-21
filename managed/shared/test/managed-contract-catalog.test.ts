import { describe, expect, it } from "vitest"

import { CONTROL_PLANE_API_VERSION } from "../src/control-plane-contract.js"
import {
  ADMISSION_STATE,
  CREATE_JOURNAL_STATE,
  CREATE_RECOVERY_OUTCOME,
  EVENT_TYPE,
  INSTANCE_LOST_REASON,
  MANAGER_MODE,
  MANAGER_MODE_CAUSE,
  MANAGER_MODE_TRANSITION,
  SESSION_STATE,
  WORKER_STATE,
} from "../src/control-plane-vocabulary.js"
import {
  AdmissionListQuerySchema,
  ManagedEventSchema,
  SessionListQuerySchema,
  WorkerListQuerySchema,
} from "../src/control-plane-resources.js"
import {
  EmptyManagedMutationBodySchema,
  MANAGED_ADMISSION_OPERATION,
  ManagedAdmissionCreateRequestSchema,
  PoolDrainRequestSchema,
  PoolResumeRequestSchema,
} from "../src/managed-route-contract.js"
import {
  MANAGED_ERROR_CATALOG,
  MANAGED_ERROR_CODE,
  ManagedErrorEnvelopeSchema,
} from "../src/error-contract.js"

const ids = {
  bootId: "018f56c8-6f7a-4c45-9e5d-77adff18f7ac",
  managerInstanceId: "118f56c8-6f7a-4c45-9e5d-77adff18f7ac",
  instanceId: "218f56c8-6f7a-4c45-9e5d-77adff18f7ac",
  sessionId: "318f56c8-6f7a-4c45-9e5d-77adff18f7ac",
  admissionId: "418f56c8-6f7a-4c45-9e5d-77adff18f7ac",
} as const
const occurredAt = "2026-07-20T00:00:00.000Z"

function event(sequence: number, fields: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return {
    apiVersion: CONTROL_PLANE_API_VERSION,
    eventId: `${ids.bootId}:${sequence}`,
    bootId: ids.bootId,
    sequence: String(sequence),
    occurredAt,
    ...fields,
  }
}

describe("exact managed request and query boundaries", () => {
  const validRequests = [
    [ManagedAdmissionCreateRequestSchema, { idempotencyKey: "request:12345678", operation: MANAGED_ADMISSION_OPERATION.SESSION_CREATE }],
    [EmptyManagedMutationBodySchema, {}],
    [PoolDrainRequestSchema, { idempotencyKey: "drain:12345678", expectedManagerInstanceId: ids.managerInstanceId, deadlineAt: occurredAt, reason: MANAGER_MODE_CAUSE.CUTOVER }],
    [PoolResumeRequestSchema, { idempotencyKey: "resume:12345678", expectedManagerInstanceId: ids.managerInstanceId, expectedSafeAt: occurredAt, reason: MANAGER_MODE_CAUSE.RECOVERY }],
    [WorkerListQuerySchema, { pageSize: 50, state: [WORKER_STATE.IDLE] }],
    [SessionListQuerySchema, { state: [SESSION_STATE.LIVE] }],
    [AdmissionListQuerySchema, {}],
  ] as const

  it.each(validRequests)("parses exact boundary row %#", (schema, input) => {
    // Given: a request containing only declared fields.
    // When: the route boundary parses it.
    const result = schema.safeParse(input)
    // Then: the request is accepted and defaults are applied.
    expect(result.success).toBe(true)
  })

  it.each(validRequests)("rejects additive boundary row %#", (schema, input) => {
    // Given: a valid request plus one undeclared property.
    // When: the strict route boundary parses it.
    const result = schema.safeParse({ ...input, undeclared: true })
    // Then: the additive field fails closed.
    expect(result.success).toBe(false)
  })

  it("excludes shutdown from operator drain and resume reasons", () => {
    // Given: a shutdown cause reserved for graceful manager lifecycle.
    const input = { idempotencyKey: "drain:12345678", expectedManagerInstanceId: ids.managerInstanceId, deadlineAt: occurredAt, reason: MANAGER_MODE_CAUSE.SHUTDOWN }
    // When: the operator drain boundary parses it.
    // Then: only the four operator reasons are accepted.
    expect(PoolDrainRequestSchema.safeParse(input).success).toBe(false)
  })
})

describe("closed error catalog", () => {
  const expectedRows = [
    [400, false, [MANAGED_ERROR_CODE.INVALID_ARGUMENT, MANAGED_ERROR_CODE.INVALID_CURSOR]],
    [401, false, [MANAGED_ERROR_CODE.ACCESS_AUTH_REQUIRED]],
    [403, false, [MANAGED_ERROR_CODE.ACCESS_FORBIDDEN]],
    [404, false, [MANAGED_ERROR_CODE.SESSION_NOT_FOUND, MANAGED_ERROR_CODE.ADMISSION_NOT_FOUND, MANAGED_ERROR_CODE.RESULT_NOT_FOUND, MANAGED_ERROR_CODE.TOOL_NOT_FOUND, MANAGED_ERROR_CODE.ROUTE_NOT_FOUND]],
    [405, false, [MANAGED_ERROR_CODE.METHOD_NOT_ALLOWED]],
    [406, false, [MANAGED_ERROR_CODE.NOT_ACCEPTABLE]],
    [409, false, [MANAGED_ERROR_CODE.MANAGED_SESSION_REQUIRED, MANAGED_ERROR_CODE.SESSION_STATE_CONFLICT, MANAGED_ERROR_CODE.CREATE_TOKEN_CONFLICT, MANAGED_ERROR_CODE.EVENT_CURSOR_RESTARTED, MANAGED_ERROR_CODE.LIST_CURSOR_RESTARTED]],
    [410, false, [MANAGED_ERROR_CODE.INSTANCE_LOST, MANAGED_ERROR_CODE.EVENT_CURSOR_EXPIRED, MANAGED_ERROR_CODE.LIST_CURSOR_EXPIRED]],
    [413, false, [MANAGED_ERROR_CODE.BODY_TOO_LARGE, MANAGED_ERROR_CODE.RESULT_TOO_LARGE]],
    [415, false, [MANAGED_ERROR_CODE.UNSUPPORTED_MEDIA_TYPE]],
    [422, false, [MANAGED_ERROR_CODE.MANAGED_FEATURE_UNSUPPORTED, MANAGED_ERROR_CODE.TOOL_INPUT_INVALID]],
    [429, true, [MANAGED_ERROR_CODE.ADMISSION_TIMEOUT, MANAGED_ERROR_CODE.QUEUE_FULL, MANAGED_ERROR_CODE.RATE_LIMITED]],
    [502, false, [MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE]],
    [503, true, [MANAGED_ERROR_CODE.NO_REACHABLE_WORKER, MANAGED_ERROR_CODE.MANAGER_DRAINING, MANAGED_ERROR_CODE.MANAGED_LIMITER_CAPACITY, MANAGED_ERROR_CODE.MANAGED_TICKET_CAPACITY, MANAGED_ERROR_CODE.MANAGED_IDEMPOTENCY_CAPACITY, MANAGED_ERROR_CODE.MANAGED_SNAPSHOT_CAPACITY, MANAGED_ERROR_CODE.MANAGED_INGRESS_CAPACITY, MANAGED_ERROR_CODE.MANAGED_AI_RESULT_CAPACITY, MANAGED_ERROR_CODE.MANAGED_ACTION_CAPACITY, MANAGED_ERROR_CODE.MANAGED_WS_CAPACITY, MANAGED_ERROR_CODE.WORKER_JOURNAL_CAPACITY]],
    [504, true, [MANAGED_ERROR_CODE.UPSTREAM_TIMEOUT, MANAGED_ERROR_CODE.TOOL_TIMEOUT]],
  ] as const

  it("matches every declared status and retryability row", () => {
    // Given: the plan's closed status groups.
    const expected = expectedRows.flatMap(([status, retryable, codes]) => codes.map((code) => [code, { status, retryable }]))
    // When: the implementation catalog is enumerated in declaration order.
    const actual = Object.entries(MANAGED_ERROR_CATALOG)
    // Then: no error code is missing, additive, or remapped.
    expect(actual).toEqual(expected)
  })

  it("rejects envelope retryability drift", () => {
    // Given: a retryable catalog code falsely marked non-retryable.
    const input = { apiVersion: CONTROL_PLANE_API_VERSION, error: { code: MANAGED_ERROR_CODE.QUEUE_FULL, message: "full", retryable: false, requestId: ids.managerInstanceId } }
    // When: the common error boundary parses it.
    // Then: the catalog remains authoritative.
    expect(ManagedErrorEnvelopeSchema.safeParse(input).success).toBe(false)
  })
})

describe("generated event discriminants", () => {
  const validEvents = [
    event(1, { type: EVENT_TYPE.WORKER_STATE_CHANGED, workerId: "worker-00", instanceId: ids.instanceId, payload: { from: WORKER_STATE.DISCOVERED, to: WORKER_STATE.REACHABLE } }),
    event(2, { type: EVENT_TYPE.SESSION_STATE_CHANGED, sessionId: ids.sessionId, payload: { from: SESSION_STATE.STARTING, to: SESSION_STATE.LIVE } }),
    event(3, { type: EVENT_TYPE.ADMISSION_STATE_CHANGED, admissionId: ids.admissionId, payload: { from: ADMISSION_STATE.STARTING, to: ADMISSION_STATE.ADMITTED } }),
    event(4, { type: EVENT_TYPE.CREATE_RECOVERY, sessionId: ids.sessionId, payload: { journalState: CREATE_JOURNAL_STATE.UNCERTAIN, outcome: CREATE_RECOVERY_OUTCOME.RECOVERED } }),
    event(5, { type: EVENT_TYPE.INSTANCE_LOST, workerId: "worker-00", instanceId: ids.instanceId, payload: { reasonCode: INSTANCE_LOST_REASON.INSTANCE_CHANGED } }),
    event(6, { type: EVENT_TYPE.MANAGER_MODE_CHANGED, payload: { transition: MANAGER_MODE_TRANSITION.DRAIN, from: MANAGER_MODE.SERVING, to: MANAGER_MODE.DRAINING, cause: MANAGER_MODE_CAUSE.SHUTDOWN, deadlineAt: occurredAt, drainEnteredAt: occurredAt, safeAt: occurredAt } }),
    event(7, { type: EVENT_TYPE.MANAGER_MODE_CHANGED, payload: { transition: MANAGER_MODE_TRANSITION.RESUME, from: MANAGER_MODE.DRAINING, to: MANAGER_MODE.SERVING, cause: MANAGER_MODE_CAUSE.RECOVERY, previousSafeAt: occurredAt, resumedAt: occurredAt } }),
  ] as const

  it.each(validEvents)("parses exact event variant %#", (input) => {
    // Given: one exact discriminated event variant.
    // When: the shared event boundary parses it.
    // Then: every declared variant is represented.
    expect(ManagedEventSchema.safeParse(input).success).toBe(true)
  })

  it.each(validEvents)("rejects additive event payload %#", (input) => {
    // Given: an exact event with one undeclared payload field.
    const mutated = { ...input, payload: { ...input.payload, internalOrigin: "http://worker-00:3000" } }
    // When: the event boundary parses it.
    // Then: private additive data is rejected.
    expect(ManagedEventSchema.safeParse(mutated).success).toBe(false)
  })
})
