import { describe, expect, it } from "vitest"

import { CONTROL_PLANE_API_VERSION } from "../src/control-plane-contract.js"
import {
  CREATE_JOURNAL_STATE,
  CREATE_RECOVERY_OUTCOME,
  CREATE_REPLAY_TEMPLATE_KIND,
  EVENT_TYPE,
  INSTANCE_LOST_REASON,
  MANAGER_MODE,
  MANAGER_MODE_CAUSE,
  MANAGER_MODE_TRANSITION,
} from "../src/control-plane-vocabulary.js"
import {
  CreateRecoveryOutcomeSchema,
  CreateReplayTemplateKindSchema,
  InstanceLostReasonSchema,
  ManagerModeTransitionSchema,
} from "../src/control-plane-vocabulary-schemas.js"
import { PublicUrlPlaceholderSchema, PUBLIC_URL_KIND } from "../src/create-replay-contract.js"
import { ManagedEventSchema } from "../src/event-contract.js"

const ids = {
  bootId: "018f56c8-6f7a-4c45-9e5d-77adff18f7ac",
  instanceId: "218f56c8-6f7a-4c45-9e5d-77adff18f7ac",
  sessionId: "318f56c8-6f7a-4c45-9e5d-77adff18f7ac",
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

describe("canonical closed payload vocabulary", () => {
  it.each([
    [CREATE_RECOVERY_OUTCOME, CreateRecoveryOutcomeSchema],
    [INSTANCE_LOST_REASON, InstanceLostReasonSchema],
    [MANAGER_MODE_TRANSITION, ManagerModeTransitionSchema],
    [CREATE_REPLAY_TEMPLATE_KIND, CreateReplayTemplateKindSchema],
  ] as const)("accepts every declared member and rejects an additive member %#", (vocabulary, schema) => {
    // Given: every canonical member plus an undeclared mutation.
    const members = Object.values(vocabulary)
    // When: each value crosses its enum schema.
    const results = members.map((member) => schema.safeParse(member).success)
    // Then: the enum is exhaustive and additive values fail closed.
    expect(results).toEqual(members.map(() => true))
    expect(schema.safeParse("UNDECLARED_MEMBER").success).toBe(false)
  })

  it("accepts both recovery outcomes and both instance-loss reasons", () => {
    // Given: every exact variant-specific payload member.
    const recoveryEvents = Object.values(CREATE_RECOVERY_OUTCOME).map((outcome, index) => event(index + 1, {
      type: EVENT_TYPE.CREATE_RECOVERY,
      sessionId: ids.sessionId,
      payload: { journalState: CREATE_JOURNAL_STATE.UNCERTAIN, outcome },
    }))
    const instanceEvents = Object.values(INSTANCE_LOST_REASON).map((reasonCode, index) => event(index + 3, {
      type: EVENT_TYPE.INSTANCE_LOST,
      workerId: "worker-00",
      instanceId: ids.instanceId,
      payload: { reasonCode },
    }))
    // When: the discriminated event union parses the full closed sets.
    const results = [...recoveryEvents, ...instanceEvents].map((input) => ManagedEventSchema.safeParse(input).success)
    // Then: no canonical branch is omitted.
    expect(results).toEqual([true, true, true, true])
  })

  it("rejects cross-wired manager transitions and replay placeholder kinds", () => {
    // Given: valid payload shapes carrying the wrong closed discriminant.
    const crossWiredDrain = event(7, {
      type: EVENT_TYPE.MANAGER_MODE_CHANGED,
      payload: {
        transition: MANAGER_MODE_TRANSITION.RESUME,
        from: MANAGER_MODE.SERVING,
        to: MANAGER_MODE.DRAINING,
        cause: MANAGER_MODE_CAUSE.SHUTDOWN,
        deadlineAt: "2026-07-20T00:01:00.000Z",
        drainEnteredAt: "2026-07-20T00:00:00.000Z",
        safeAt: "2026-07-20T00:10:00.000Z",
      },
    })
    const placeholder = {
      kind: CREATE_REPLAY_TEMPLATE_KIND.PUBLIC_URL,
      urlKind: PUBLIC_URL_KIND.WEBSOCKET,
      sessionId: ids.sessionId,
    }
    // When: event and replay boundaries validate the discriminants.
    // Then: only the canonical placeholder is accepted and the cross-wire fails.
    expect(ManagedEventSchema.safeParse(crossWiredDrain).success).toBe(false)
    expect(PublicUrlPlaceholderSchema.safeParse(placeholder).success).toBe(true)
    expect(PublicUrlPlaceholderSchema.safeParse({ ...placeholder, kind: "STATIC_URL" }).success).toBe(false)
  })
})
