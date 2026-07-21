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
  type AdmissionState,
  type SessionState,
  type WorkerState,
} from "../src/control-plane-vocabulary.js"
import {
  canAdmissionTransition,
  canSessionTransition,
  canWorkerTransition,
} from "../src/control-plane-transitions.js"
import { ManagedEventSchema } from "../src/event-contract.js"

const ids = {
  bootId: "018f56c8-6f7a-4c45-9e5d-77adff18f7ac",
  instanceId: "218f56c8-6f7a-4c45-9e5d-77adff18f7ac",
  sessionId: "318f56c8-6f7a-4c45-9e5d-77adff18f7ac",
  admissionId: "418f56c8-6f7a-4c45-9e5d-77adff18f7ac",
} as const

function event(sequence: number, fields: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return {
    apiVersion: CONTROL_PLANE_API_VERSION,
    eventId: `${ids.bootId}:${sequence}`,
    bootId: ids.bootId,
    sequence: String(sequence),
    occurredAt: "2026-07-20T00:00:00.000Z",
    ...fields,
  }
}

const subjectCases = [
  {
    valid: event(1, { type: EVENT_TYPE.WORKER_STATE_CHANGED, workerId: "worker-00", instanceId: ids.instanceId, payload: { from: WORKER_STATE.DISCOVERED, to: WORKER_STATE.REACHABLE } }),
    missing: event(1, { type: EVENT_TYPE.WORKER_STATE_CHANGED, payload: { from: WORKER_STATE.DISCOVERED, to: WORKER_STATE.REACHABLE } }),
    wrong: event(1, { type: EVENT_TYPE.WORKER_STATE_CHANGED, workerId: "worker-00", instanceId: ids.instanceId, sessionId: ids.sessionId, payload: { from: WORKER_STATE.DISCOVERED, to: WORKER_STATE.REACHABLE } }),
  },
  {
    valid: event(2, { type: EVENT_TYPE.SESSION_STATE_CHANGED, sessionId: ids.sessionId, payload: { from: SESSION_STATE.STARTING, to: SESSION_STATE.LIVE } }),
    missing: event(2, { type: EVENT_TYPE.SESSION_STATE_CHANGED, payload: { from: SESSION_STATE.STARTING, to: SESSION_STATE.LIVE } }),
    wrong: event(2, { type: EVENT_TYPE.SESSION_STATE_CHANGED, sessionId: ids.sessionId, admissionId: ids.admissionId, payload: { from: SESSION_STATE.STARTING, to: SESSION_STATE.LIVE } }),
  },
  {
    valid: event(3, { type: EVENT_TYPE.ADMISSION_STATE_CHANGED, admissionId: ids.admissionId, payload: { from: ADMISSION_STATE.STARTING, to: ADMISSION_STATE.ADMITTED } }),
    missing: event(3, { type: EVENT_TYPE.ADMISSION_STATE_CHANGED, payload: { from: ADMISSION_STATE.STARTING, to: ADMISSION_STATE.ADMITTED } }),
    wrong: event(3, { type: EVENT_TYPE.ADMISSION_STATE_CHANGED, admissionId: ids.admissionId, sessionId: ids.sessionId, payload: { from: ADMISSION_STATE.STARTING, to: ADMISSION_STATE.ADMITTED } }),
  },
  {
    valid: event(4, { type: EVENT_TYPE.CREATE_RECOVERY, sessionId: ids.sessionId, payload: { journalState: CREATE_JOURNAL_STATE.UNCERTAIN, outcome: CREATE_RECOVERY_OUTCOME.RECOVERED } }),
    missing: event(4, { type: EVENT_TYPE.CREATE_RECOVERY, payload: { journalState: CREATE_JOURNAL_STATE.UNCERTAIN, outcome: CREATE_RECOVERY_OUTCOME.RECOVERED } }),
    wrong: event(4, { type: EVENT_TYPE.CREATE_RECOVERY, sessionId: ids.sessionId, admissionId: ids.admissionId, payload: { journalState: CREATE_JOURNAL_STATE.UNCERTAIN, outcome: CREATE_RECOVERY_OUTCOME.RECOVERED } }),
  },
  {
    valid: event(5, { type: EVENT_TYPE.INSTANCE_LOST, workerId: "worker-00", instanceId: ids.instanceId, payload: { reasonCode: INSTANCE_LOST_REASON.INSTANCE_CHANGED } }),
    missing: event(5, { type: EVENT_TYPE.INSTANCE_LOST, payload: { reasonCode: INSTANCE_LOST_REASON.INSTANCE_CHANGED } }),
    wrong: event(5, { type: EVENT_TYPE.INSTANCE_LOST, workerId: "worker-00", instanceId: ids.instanceId, sessionId: ids.sessionId, payload: { reasonCode: INSTANCE_LOST_REASON.INSTANCE_CHANGED } }),
  },
] as const

function expectTransitionMatrix<State extends string>(
  states: readonly State[],
  allowed: (from: State, to: State) => boolean,
  build: (from: State, to: State) => Readonly<Record<string, unknown>>,
): void {
  for (const from of states) {
    for (const to of states) {
      expect(ManagedEventSchema.safeParse(build(from, to)).success).toBe(allowed(from, to))
    }
  }
}

describe("managed event subject and transition oracle", () => {
  it.each(subjectCases)("requires the exact subject for event variant %#", ({ valid, missing, wrong }) => {
    // Given: one valid subject, one missing subject, and one unrelated subject for the same variant.
    // When: all three variants cross the managed event boundary.
    const results = [valid, missing, wrong].map((input) => ManagedEventSchema.safeParse(input).success)
    // Then: only the event carrying its declared subject is accepted.
    expect(results).toEqual([true, false, false])
  })

  it.each([
    event(9, { type: EVENT_TYPE.MANAGER_MODE_CHANGED, workerId: "worker-00", payload: { transition: MANAGER_MODE_TRANSITION.DRAIN, from: MANAGER_MODE.SERVING, to: MANAGER_MODE.DRAINING, cause: MANAGER_MODE_CAUSE.SHUTDOWN, deadlineAt: "2026-07-20T00:01:00.000Z", drainEnteredAt: "2026-07-20T00:00:00.000Z", safeAt: "2026-07-20T00:10:00.000Z" } }),
    event(10, { type: EVENT_TYPE.MANAGER_MODE_CHANGED, sessionId: ids.sessionId, payload: { transition: MANAGER_MODE_TRANSITION.RESUME, from: MANAGER_MODE.DRAINING, to: MANAGER_MODE.SERVING, cause: MANAGER_MODE_CAUSE.RECOVERY, previousSafeAt: "2026-07-20T00:10:00.000Z", resumedAt: "2026-07-20T00:11:00.000Z" } }),
  ])("rejects a resource subject on pool-scoped manager variant %#", (input) => {
    // Given: a pool-scoped manager event carrying an unrelated resource subject.
    // When: the strict event variant parses it.
    // Then: the unrelated subject is rejected.
    expect(ManagedEventSchema.safeParse(input).success).toBe(false)
  })

  it("matches every worker transition cell to the independent oracle", () => {
    // Given: every ordered pair in the closed worker lifecycle.
    // When: each pair is encoded as a correctly-subjected worker event.
    // Then: schema acceptance exactly matches the independent transition predicate.
    expectTransitionMatrix<WorkerState>(Object.values(WORKER_STATE), canWorkerTransition, (from, to) => event(11, {
      type: EVENT_TYPE.WORKER_STATE_CHANGED,
      workerId: "worker-00",
      instanceId: ids.instanceId,
      payload: { from, to },
    }))
  })

  it("matches every session transition cell to the independent oracle", () => {
    // Given: every ordered pair in the closed session lifecycle.
    // When: each pair is encoded as a correctly-subjected session event.
    // Then: schema acceptance exactly matches the independent transition predicate.
    expectTransitionMatrix<SessionState>(Object.values(SESSION_STATE), canSessionTransition, (from, to) => event(12, {
      type: EVENT_TYPE.SESSION_STATE_CHANGED,
      sessionId: ids.sessionId,
      payload: { from, to },
    }))
  })

  it("matches every admission transition cell to the independent oracle", () => {
    // Given: every ordered pair in the closed admission lifecycle.
    // When: each pair is encoded as a correctly-subjected admission event.
    // Then: schema acceptance exactly matches the independent transition predicate.
    expectTransitionMatrix<AdmissionState>(Object.values(ADMISSION_STATE), canAdmissionTransition, (from, to) => event(13, {
      type: EVENT_TYPE.ADMISSION_STATE_CHANGED,
      admissionId: ids.admissionId,
      payload: { from, to },
    }))
  })

  it.each([
    event(6, { type: EVENT_TYPE.WORKER_STATE_CHANGED, workerId: "worker-00", instanceId: ids.instanceId, payload: { from: WORKER_STATE.LIVE, to: WORKER_STATE.IDLE } }),
    event(7, { type: EVENT_TYPE.SESSION_STATE_CHANGED, sessionId: ids.sessionId, payload: { from: SESSION_STATE.RELEASED, to: SESSION_STATE.LIVE } }),
    event(8, { type: EVENT_TYPE.ADMISSION_STATE_CHANGED, admissionId: ids.admissionId, payload: { from: ADMISSION_STATE.ADMITTED, to: ADMISSION_STATE.STARTING } }),
  ])("rejects lifecycle transition outside its independent oracle %#", (input) => {
    // Given: a well-shaped subject event whose lifecycle edge is illegal.
    // When: the event boundary validates the transition.
    // Then: the event is rejected despite its individually valid state literals.
    expect(ManagedEventSchema.safeParse(input).success).toBe(false)
  })
})
