import { describe, expect, it } from "vitest"

import {
  AdmissionIdSchema,
  BootIdSchema,
  CanonicalCursorSequenceSchema,
  CreateIdempotencyKeySchema,
  CreateTokenSchema,
  EventSequenceSchema,
  InstanceIdSchema,
  PoolIdSchema,
  ResultIdSchema,
  SessionIdSchema,
  Sha256Schema,
  WorkerIdSchema,
  parseSequenceBigInt,
} from "../src/control-plane-primitives.js"
import {
  ADMISSION_STATE,
  CREATE_JOURNAL_STATE,
  CREATE_REPLAY_STATE,
  EMERGENCY_RECOVERY_STATE,
  EVENT_TYPE,
  LEGACY_BOOTSTRAP_STATE,
  MANAGER_MODE,
  CONTROL_PLANE_SESSION_ID_MODE,
  PRINCIPAL_ROLE,
  SESSION_STATE,
  WORKER_STATE,
} from "../src/control-plane-vocabulary.js"
import {
  AdmissionStateSchema,
  CreateJournalStateSchema,
  CreateReplayStateSchema,
  EmergencyRecoveryStateSchema,
  EventTypeSchema,
  LegacyBootstrapStateSchema,
  ManagerModeSchema,
  PrincipalRoleSchema,
  SessionStateSchema,
  WorkerStateSchema,
} from "../src/control-plane-vocabulary-schemas.js"
import { SESSION_ID_MODE } from "../src/upstream-corpus-model.js"

describe("control-plane wire primitives", () => {
  it("uses the corpus SessionIdMode object as the single canonical vocabulary", () => {
    // Given: the corpus verdict and control-plane contract vocabulary.
    // When: their runtime objects are compared.
    // Then: both consumers share one canonical enum object.
    expect(CONTROL_PLANE_SESSION_ID_MODE).toBe(SESSION_ID_MODE)
  })

  it.each([
    [WorkerStateSchema, WORKER_STATE.IDLE],
    [SessionStateSchema, SESSION_STATE.LIVE],
    [AdmissionStateSchema, ADMISSION_STATE.QUEUED],
    [CreateJournalStateSchema, CREATE_JOURNAL_STATE.UPSTREAM_PENDING],
    [CreateReplayStateSchema, CREATE_REPLAY_STATE.WORKER_PENDING],
    [ManagerModeSchema, MANAGER_MODE.DRAINING],
    [EmergencyRecoveryStateSchema, EMERGENCY_RECOVERY_STATE.MAINTENANCE],
    [LegacyBootstrapStateSchema, LEGACY_BOOTSTRAP_STATE.EDGE_FENCED],
    [PrincipalRoleSchema, PRINCIPAL_ROLE.OPERATOR],
    [EventTypeSchema, EVENT_TYPE.CREATE_RECOVERY],
  ] as const)("parses declared closed member %#", (schema, member) => {
    // Given: one declared member at a wire boundary.
    // When: the matching schema parses the value.
    const result = schema.safeParse(member)
    // Then: the canonical member is accepted.
    expect(result.success).toBe(true)
  })

  it.each([
    WorkerStateSchema,
    SessionStateSchema,
    AdmissionStateSchema,
    CreateJournalStateSchema,
    CreateReplayStateSchema,
    ManagerModeSchema,
    EmergencyRecoveryStateSchema,
    LegacyBootstrapStateSchema,
    PrincipalRoleSchema,
    EventTypeSchema,
  ])("rejects an unknown closed member", (schema) => {
    // Given: a value absent from every closed vocabulary.
    // When: a lifecycle schema parses it.
    const result = schema.safeParse("UNKNOWN_MEMBER")
    // Then: the boundary fails closed.
    expect(result.success).toBe(false)
  })

  it.each([
    [PoolIdSchema, "managed-blue"],
    [WorkerIdSchema, "worker-01"],
    [InstanceIdSchema, "018f56c8-6f7a-4c45-9e5d-77adff18f7ac"],
    [SessionIdSchema, "118f56c8-6f7a-4c45-9e5d-77adff18f7ac"],
    [AdmissionIdSchema, "218f56c8-6f7a-4c45-9e5d-77adff18f7ac"],
    [ResultIdSchema, "318f56c8-6f7a-4c45-9e5d-77adff18f7ac"],
    [BootIdSchema, "418f56c8-6f7a-4c45-9e5d-77adff18f7ac"],
    [Sha256Schema, "a".repeat(64)],
    [CreateIdempotencyKeySchema, "request:12345678"],
    [CreateTokenSchema, `h1_${"b".repeat(64)}`],
  ] as const)("parses branded primitive %#", (schema, value) => {
    // Given: a canonical primitive representation.
    // When: its branded schema parses the value.
    const result = schema.safeParse(value)
    // Then: the boundary accepts it.
    expect(result.success).toBe(true)
  })

  it("rejects unsafe or noncanonical event sequences", () => {
    // Given: JSON-number and noncanonical decimal representations.
    const invalid = [1, "00", "01", "18446744073709551616"]
    // When: each value crosses the event sequence boundary.
    const results = invalid.map((value) => EventSequenceSchema.safeParse(value).success)
    // Then: none can lose uint64 precision or canonical form.
    expect(results).toEqual([false, false, false, false])
  })

  it("keeps cursor predecessor zero distinct from real event one", () => {
    // Given: the empty-ledger predecessor and first real sequence.
    const predecessor = CanonicalCursorSequenceSchema.parse("0")
    const first = EventSequenceSchema.parse("1")
    // When: both are converted only after string parsing.
    const values = [parseSequenceBigInt(predecessor), parseSequenceBigInt(first)]
    // Then: exact bigint values are retained.
    expect(values).toEqual([0n, 1n])
  })
})
