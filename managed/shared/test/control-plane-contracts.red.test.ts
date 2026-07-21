import { describe, expect, it } from "vitest"

import { parseControlPlaneConfig } from "../src/control-plane-config.js"
import { canWorkerTransition } from "../src/control-plane-transitions.js"
import { WorkerStateSchema } from "../src/control-plane-vocabulary-schemas.js"
import { WORKER_STATE } from "../src/control-plane-vocabulary.js"
import {
  AdmissionListQuerySchema,
  SessionListQuerySchema,
  WorkerListQuerySchema,
} from "../src/managed-resources.js"
import {
  EmptyManagedMutationBodySchema,
  ManagedAdmissionCreateRequestSchema,
  PoolDrainRequestSchema,
  PoolResumeRequestSchema,
} from "../src/managed-route-contract.js"

describe("Task 7 shared control-plane contract availability", () => {
  it.each([
    ManagedAdmissionCreateRequestSchema,
    EmptyManagedMutationBodySchema,
    PoolDrainRequestSchema,
    PoolResumeRequestSchema,
    WorkerListQuerySchema,
    SessionListQuerySchema,
    AdmissionListQuerySchema,
  ])("rejects additive input at managed boundary %#", (schema) => {
    // Given: one required managed request or query boundary.
    // When: additive input crosses the strict boundary.
    // Then: undeclared data is rejected.
    expect(schema.safeParse({ undeclared: true }).success).toBe(false)
  })

  it("rejects an unknown worker wire state", () => {
    // Given: the canonical WorkerState boundary schema.
    // When: an undeclared lifecycle member crosses the wire boundary.
    const result = WorkerStateSchema.safeParse("LIVE_BUT_UNTYPED")

    // Then: parsing fails closed.
    expect(result.success).toBe(false)
  })

  it("rejects the illegal LIVE to IDLE worker transition", () => {
    // Given: the canonical transition predicate.
    // When: a live worker is moved directly to idle without release.
    const allowed = canWorkerTransition(WORKER_STATE.LIVE, WORKER_STATE.IDLE)

    // Then: the transition is rejected.
    expect(allowed).toBe(false)
  })

  it("rejects a dual-active managed configuration before listen", () => {
    // Given: the canonical normalized control-plane configuration parser.
    // When: the old dual-running manager assumption is supplied.
    const parse = () => parseControlPlaneConfig({ maxConcurrentManagedProjects: 2 })

    // Then: the cold-standby overlay invariant rejects it.
    expect(parse).toThrow()
  })
})
