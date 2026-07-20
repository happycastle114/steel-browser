import { describe, expect, it } from "vitest"

import {
  CAPACITY_GATE_OUTCOME,
  COMPOSITE_ROUTE_PHASE,
  COOLIFY_COMPOSE_DEPLOYMENT_MODE,
  COOLIFY_DEPLOYMENT_STATUS,
  COOLIFY_OPERATION_STATE,
  COOLIFY_PRODUCTION_OWNER,
  DEPLOYMENT_CAPACITY_STATUS,
  DEPLOYMENT_GATE_OUTCOME,
  EDGE_ROUTE_MODE,
  FINGERPRINT_PROOF_LEVEL,
  HANDOVER_RUNTIME_BY_STATE,
  MANAGED_HANDOVER_SEQUENCE,
  MANAGED_HANDOVER_STATE,
  ManagedDeploymentSourceConfigSchema,
  ManagedDeploymentTopologySchema,
  CompositeRouteTupleSchema,
  CutoverGateSchema,
  HandoverTransitionSchema,
  InvalidCompositeRouteError,
  STEEL_SERVING_TARGET,
  evaluatePressureCapacity,
  evaluateShmTmpfsCapacity,
  resolveSteelServingTarget,
} from "../src/managed-overlay.js"
import {
  activeProject,
  coldProject,
  validCutoverGate,
  validPressureCapacity,
  validShmTmpfsCapacity,
  validSourceConfig,
  validTopology,
} from "./deployment-topology-fixtures.js"

describe("deployment-topology invalid fixtures", () => {
  it("rejects two active projects and any stable topology without exactly one active project", () => {
    // Given: overlapping and zero-active managed project observations.
    const overlapping = { ...validTopology(), projects: [activeProject(), activeProject(COOLIFY_PRODUCTION_OWNER.MANAGED_GREEN)] }
    const zeroActive = { ...validTopology(), projects: [coldProject(COOLIFY_PRODUCTION_OWNER.MANAGED_BLUE), coldProject()] }

    // When: both observations cross the topology boundary.
    const results = [
      ManagedDeploymentTopologySchema.safeParse(overlapping),
      ManagedDeploymentTopologySchema.safeParse(zeroActive),
    ]

    // Then: neither illegal cardinality is representable.
    expect(results.every((result) => !result.success)).toBe(true)
  })

  it.each([1, 3, 4])("rejects active worker count %i", (activeWorkerCount) => {
    // Given: the canonical source config with a non-two active count.
    const input = { ...validSourceConfig(), activeWorkerCount }

    // When: the source boundary parses it.
    const result = ManagedDeploymentSourceConfigSchema.safeParse(input)

    // Then: the fixed two-worker invariant rejects it.
    expect(result.success).toBe(false)
  })

  it("accepts total verified capacity two instead of the removed four-worker/two-pool gate", () => {
    // Given: exactly the one active pool's two-worker verified capacity.
    const input = { ...validSourceConfig(), maxVerifiedWorkersTotal: 2 }

    // When: the source boundary parses it.
    const result = ManagedDeploymentSourceConfigSchema.safeParse(input)

    // Then: the obsolete maxVerifiedWorkersTotal>=4 formula is not applied.
    expect(result.success).toBe(true)
  })

  it.each([
    ["containerCount", 1],
    ["listenerCount", 1],
    ["connectionCount", 1],
    ["automaticRestartEnabled", true],
  ])("rejects cold standby runtime mutation %s", (field, value) => {
    // Given: a cold project carrying one forbidden runtime property.
    const input = {
      ...validTopology(),
      projects: [activeProject(), { ...coldProject(), [field]: value }],
    }

    // When: the topology boundary parses it.
    const result = ManagedDeploymentTopologySchema.safeParse(input)

    // Then: the cold project is rejected rather than treated as equivalent configuration.
    expect(result.success).toBe(false)
  })

  it("rejects parsed Compose mode and any manager secret grant drift", () => {
    // Given: parsed mode, a worker secret grant, a container env key, and a service env file.
    const source = validSourceConfig()
    const inputs = [
      { ...source, composeDeploymentMode: "PARSED" },
      { ...source, managerSecret: { ...source.managerSecret, workerGrantCount: 1 } },
      { ...source, managerSecret: { ...source.managerSecret, containerEnvironmentKeys: ["STEEL_MANAGED_CREATE_TOKEN_KEY_HEX"] } },
      { ...source, managerSecret: { ...source.managerSecret, serviceEnvironmentFiles: ["generated.env"] } },
    ]

    // When: every secret/config mutation crosses the source boundary.
    const results = inputs.map((input) => ManagedDeploymentSourceConfigSchema.safeParse(input))

    // Then: only RAW_EXPLICIT_PROXY with a manager-only file grant is representable.
    expect(results.every((result) => !result.success)).toBe(true)
    expect(source.composeDeploymentMode).toBe(COOLIFY_COMPOSE_DEPLOYMENT_MODE.RAW_EXPLICIT_PROXY)
  })

  it("rejects every composite route tuple outside the explicit mapping", () => {
    // Given: the complete enum cross-product and an independent set of legal tuple keys.
    const legal = new Set([
      [EDGE_ROUTE_MODE.COOLIFY_PROXY, COMPOSITE_ROUTE_PHASE.PROXY_CURRENT_OWNER, COOLIFY_PRODUCTION_OWNER.LEGACY, STEEL_SERVING_TARGET.LEGACY].join("|"),
      [EDGE_ROUTE_MODE.COOLIFY_PROXY, COMPOSITE_ROUTE_PHASE.PROXY_CURRENT_OWNER, COOLIFY_PRODUCTION_OWNER.MANAGED_BLUE, STEEL_SERVING_TARGET.MANAGED_BLUE].join("|"),
      [EDGE_ROUTE_MODE.COOLIFY_PROXY, COMPOSITE_ROUTE_PHASE.PROXY_CURRENT_OWNER, COOLIFY_PRODUCTION_OWNER.MANAGED_GREEN, STEEL_SERVING_TARGET.MANAGED_GREEN].join("|"),
      [EDGE_ROUTE_MODE.MAINTENANCE, COMPOSITE_ROUTE_PHASE.MAINTENANCE_OLD_OWNER, COOLIFY_PRODUCTION_OWNER.LEGACY, STEEL_SERVING_TARGET.MAINTENANCE].join("|"),
      [EDGE_ROUTE_MODE.MAINTENANCE, COMPOSITE_ROUTE_PHASE.MAINTENANCE_OLD_OWNER, COOLIFY_PRODUCTION_OWNER.MANAGED_BLUE, STEEL_SERVING_TARGET.MAINTENANCE].join("|"),
      [EDGE_ROUTE_MODE.MAINTENANCE, COMPOSITE_ROUTE_PHASE.MAINTENANCE_OLD_OWNER, COOLIFY_PRODUCTION_OWNER.MANAGED_GREEN, STEEL_SERVING_TARGET.MAINTENANCE].join("|"),
      [EDGE_ROUTE_MODE.MAINTENANCE, COMPOSITE_ROUTE_PHASE.MAINTENANCE_NO_OWNER, COOLIFY_PRODUCTION_OWNER.NONE, STEEL_SERVING_TARGET.MAINTENANCE].join("|"),
      [EDGE_ROUTE_MODE.MAINTENANCE, COMPOSITE_ROUTE_PHASE.MAINTENANCE_NEW_OWNER, COOLIFY_PRODUCTION_OWNER.LEGACY, STEEL_SERVING_TARGET.MAINTENANCE].join("|"),
      [EDGE_ROUTE_MODE.MAINTENANCE, COMPOSITE_ROUTE_PHASE.MAINTENANCE_NEW_OWNER, COOLIFY_PRODUCTION_OWNER.MANAGED_BLUE, STEEL_SERVING_TARGET.MAINTENANCE].join("|"),
      [EDGE_ROUTE_MODE.MAINTENANCE, COMPOSITE_ROUTE_PHASE.MAINTENANCE_NEW_OWNER, COOLIFY_PRODUCTION_OWNER.MANAGED_GREEN, STEEL_SERVING_TARGET.MAINTENANCE].join("|"),
    ])
    const cases = Object.values(EDGE_ROUTE_MODE).flatMap((edgeRouteMode) =>
      Object.values(COMPOSITE_ROUTE_PHASE).flatMap((phase) =>
        Object.values(COOLIFY_PRODUCTION_OWNER).flatMap((productionOwner) =>
          Object.values(STEEL_SERVING_TARGET).map((servingTarget) => ({
            edgeRouteMode,
            phase,
            productionOwner,
            servingTarget,
          })),
        ),
      ),
    )

    // When: every tuple is validated against the canonical schema.
    const mismatches = cases.filter((route) => {
      const key = [route.edgeRouteMode, route.phase, route.productionOwner, route.servingTarget].join("|")
      const result = CompositeRouteTupleSchema.safeParse({
        ...route,
        ownerObservationCount: route.productionOwner === COOLIFY_PRODUCTION_OWNER.NONE ? 0 : 1,
      })
      return result.success !== legal.has(key)
    })

    // Then: the schema accepts exactly the ten enumerated tuples and rejects every other tuple.
    expect(mismatches).toEqual([])
  })

  it("rejects proxy NONE and every multiple-owner observation", () => {
    // Given: a proxy tuple with no owner and a maintenance tuple with two observations.
    const inputs = [
      {
        edgeRouteMode: EDGE_ROUTE_MODE.COOLIFY_PROXY,
        phase: COMPOSITE_ROUTE_PHASE.PROXY_CURRENT_OWNER,
        productionOwner: COOLIFY_PRODUCTION_OWNER.NONE,
        ownerObservationCount: 0,
        servingTarget: STEEL_SERVING_TARGET.MAINTENANCE,
      },
      {
        edgeRouteMode: EDGE_ROUTE_MODE.MAINTENANCE,
        phase: COMPOSITE_ROUTE_PHASE.MAINTENANCE_OLD_OWNER,
        productionOwner: COOLIFY_PRODUCTION_OWNER.LEGACY,
        ownerObservationCount: 2,
        servingTarget: STEEL_SERVING_TARGET.MAINTENANCE,
      },
    ]

    // When: both ambiguous observations cross the route boundary.
    const results = inputs.map((input) => CompositeRouteTupleSchema.safeParse(input))

    // Then: neither can produce a serving target.
    expect(results.every((result) => !result.success)).toBe(true)
  })

  it("fails closed with the typed route error at the resolver boundary", () => {
    // Given: a proxy observation with no production owner.
    const input = {
      edgeRouteMode: EDGE_ROUTE_MODE.COOLIFY_PROXY,
      phase: COMPOSITE_ROUTE_PHASE.PROXY_CURRENT_OWNER,
      productionOwner: COOLIFY_PRODUCTION_OWNER.NONE,
      ownerObservationCount: 0,
    }

    // When/Then: resolution rejects through the public closed error surface.
    expect(() => resolveSteelServingTarget(input)).toThrow(InvalidCompositeRouteError)
  })

  it("rejects every non-adjacent or unknown handover transition", () => {
    // Given: the complete known-state cross-product plus one unknown target.
    const knownCases = MANAGED_HANDOVER_SEQUENCE.flatMap((from) =>
      MANAGED_HANDOVER_SEQUENCE.map((to) => ({
        from,
        to,
        ...HANDOVER_RUNTIME_BY_STATE[to],
        capacityStatus: DEPLOYMENT_CAPACITY_STATUS.VERIFIED,
      })),
    )
    const adjacent = new Set(
      MANAGED_HANDOVER_SEQUENCE.slice(1).map((to, index) => `${String(MANAGED_HANDOVER_SEQUENCE[index])}|${to}`),
    )

    // When: every known pair and the unknown mutation are parsed.
    const mismatches = knownCases.filter((transition) => {
      const result = HandoverTransitionSchema.safeParse(transition)
      return result.success !== adjacent.has(`${String(transition.from)}|${transition.to}`)
    })
    const unknown = HandoverTransitionSchema.safeParse({
      from: MANAGED_HANDOVER_STATE.DOMAIN_NONE,
      to: "UNKNOWN_TRANSITION",
      activeProjectRunning: false,
      standbyProjectRunning: false,
      capacityStatus: DEPLOYMENT_CAPACITY_STATUS.VERIFIED,
    })

    // Then: only immediate sequence edges pass and the unknown member fails closed.
    expect(mismatches).toEqual([])
    expect(unknown.success).toBe(false)
  })

  it("rejects runtime overlap and starting standby before the losing project stops", () => {
    // Given: an otherwise adjacent standby-start transition with unsafe runtime observations.
    const base = {
      from: MANAGED_HANDOVER_STATE.STANDBY_CONFIG_BOUND,
      to: MANAGED_HANDOVER_STATE.STANDBY_STARTED,
      capacityStatus: DEPLOYMENT_CAPACITY_STATUS.VERIFIED,
    }
    const inputs = [
      { ...base, activeProjectRunning: true, standbyProjectRunning: true },
      { ...base, activeProjectRunning: true, standbyProjectRunning: false },
    ]

    // When: both unsafe runtime observations cross the transition boundary.
    const results = inputs.map((input) => HandoverTransitionSchema.safeParse(input))

    // Then: zero overlap and stop-before-start are mandatory.
    expect(results.every((result) => !result.success)).toBe(true)
  })

  it("rejects unverified capacity and every typed cutover blocker", () => {
    // Given: every non-verified capacity status/gate and deployment gate outcome.
    const gate = validCutoverGate()
    const inputs = [
      { ...gate, capacityStatus: DEPLOYMENT_CAPACITY_STATUS.UNVERIFIED_UNTIL_TASK_41 },
      { ...gate, capacityStatus: DEPLOYMENT_CAPACITY_STATUS.BLOCKED_COOLIFY_CAPACITY },
      ...Object.values(CAPACITY_GATE_OUTCOME)
        .filter((outcome) => outcome !== CAPACITY_GATE_OUTCOME.VERIFIED)
        .map((capacityGateOutcome) => ({ ...gate, capacityGateOutcome })),
      ...Object.values(DEPLOYMENT_GATE_OUTCOME)
        .filter((outcome) => outcome !== DEPLOYMENT_GATE_OUTCOME.VERIFIED)
        .map((deploymentGateOutcome) => ({ ...gate, deploymentGateOutcome })),
    ]

    // When: every blocker crosses the cutover boundary.
    const results = inputs.map((input) => CutoverGateSchema.safeParse(input))

    // Then: no capacity, secret, safe-target, operation, or route blocker can cut over.
    expect(results.every((result) => !result.success)).toBe(true)
  })

  it("rejects config-only fingerprints and every nonterminal Coolify operation state", () => {
    // Given: config-bound proof, request/failure/unknown operation states, and non-finished deployments.
    const gate = validCutoverGate()
    const inputs = [
      { ...gate, fingerprintProofLevel: FINGERPRINT_PROOF_LEVEL.CONFIG_BOUND },
      ...Object.values(COOLIFY_OPERATION_STATE)
        .filter((state) => state !== COOLIFY_OPERATION_STATE.TERMINAL_SUCCESS)
        .map((operationState) => ({ ...gate, operationState })),
      ...Object.values(COOLIFY_DEPLOYMENT_STATUS)
        .filter((status) => status !== COOLIFY_DEPLOYMENT_STATUS.FINISHED)
        .map((deploymentStatus) => ({ ...gate, deploymentStatus })),
    ]

    // When: each operation/fingerprint mutation crosses the cutover boundary.
    const results = inputs.map((input) => CutoverGateSchema.safeParse(input))

    // Then: queued, failed, cancelled, unknown, or config-only proof cannot cut over.
    expect(results.every((result) => !result.success)).toBe(true)
  })

  it("returns measurement and shm/tmpfs blockers for stale or incomplete evidence", () => {
    // Given: missing pressure data, a stale baseline, and an unbounded worker mount.
    const pressure = validPressureCapacity()
    const ephemeral = validShmTmpfsCapacity()

    // When: the incomplete inputs are evaluated.
    const outcomes = [
      evaluatePressureCapacity({ ...pressure, baselineUsableSamples: 299 }),
      evaluateShmTmpfsCapacity({ ...ephemeral, measurementFresh: false }),
      evaluateShmTmpfsCapacity({ ...ephemeral, mountsBounded: false }),
      evaluateShmTmpfsCapacity({ ...ephemeral, warmIdleUsableSamplesByWorker: [300, 299] }),
    ]

    // Then: missing samples and unsafe ephemeral evidence retain distinct typed blockers.
    expect(outcomes.map((result) => result.outcome)).toEqual([
      CAPACITY_GATE_OUTCOME.BLOCKED_MEASUREMENT,
      CAPACITY_GATE_OUTCOME.BLOCKED_SHM_TMPFS,
      CAPACITY_GATE_OUTCOME.BLOCKED_SHM_TMPFS,
      CAPACITY_GATE_OUTCOME.BLOCKED_SHM_TMPFS,
    ])
  })

  it.each([
    ["oomCount", 1],
    ["oomKillCount", 1],
    ["restartCount", 1],
    ["failedHealthProbeCount", 1],
    ["memoryThresholdsVerified", false],
    ["cpuThresholdsVerified", false],
    ["diskThresholdsVerified", false],
    ["inodeThresholdsVerified", false],
  ])("blocks pressure mutation %s", (field, value) => {
    // Given: a complete pressure observation with one fatal counter or threshold mutation.
    const input = { ...validPressureCapacity(), [field]: value }

    // When: the pressure gate evaluates it.
    const result = evaluatePressureCapacity(input)

    // Then: the live pressure evidence fails closed.
    expect(result.outcome).toBe(CAPACITY_GATE_OUTCOME.BLOCKED_PRESSURE)
  })
})
