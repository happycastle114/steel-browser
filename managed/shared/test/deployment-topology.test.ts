import { describe, expect, it } from "vitest"

import {
  COMPOSITE_ROUTE_PHASE,
  COOLIFY_PRODUCTION_OWNER,
  DEPLOYMENT_CAPACITY_STATUS,
  EDGE_ROUTE_MODE,
  HANDOVER_RUNTIME_BY_STATE,
  MANAGED_HANDOVER_SEQUENCE,
  MANAGED_PROJECT_RUNTIME_STATE,
  ManagedDeploymentSourceConfigSchema,
  ManagedDeploymentTopologySchema,
  CompositeRouteTupleSchema,
  HandoverTransitionSchema,
  StartupGateSchema,
  STEEL_SERVING_TARGET,
} from "../src/managed-overlay.js"
import { validSourceConfig, validTopology } from "./deployment-topology-fixtures.js"

describe("deployment-topology canonical happy paths", () => {
  it("accepts the fixed source topology before Task 41 verification", () => {
    // Given: the canonical source configuration with the explicit pre-live capacity marker.
    const input = validSourceConfig(DEPLOYMENT_CAPACITY_STATUS.UNVERIFIED_UNTIL_TASK_41)

    // When: the source and startup boundaries parse it.
    const parsed = ManagedDeploymentSourceConfigSchema.parse(input)
    const startup = StartupGateSchema.parse({ capacityStatus: input.capacityStatus })

    // Then: they preserve exactly one runtime project and two static workers.
    expect(parsed.maxConcurrentManagedProjects).toBe(1)
    expect(parsed.activeWorkerCount).toBe(2)
    expect(parsed.maxVerifiedWorkersTotal).toBe(2)
    expect(startup.capacityStatus).toBe(DEPLOYMENT_CAPACITY_STATUS.UNVERIFIED_UNTIL_TASK_41)
    expect(parsed.staticWorkerEndpoints).toEqual([
      "worker-00=http://worker-00:3000",
      "worker-01=http://worker-01:3000",
    ])
  })

  it("accepts one active project and one zero-runtime cold standby", () => {
    // Given: blue is active with one manager and two workers, while green is cold.
    const input = validTopology()

    // When: the topology boundary parses it.
    const parsed = ManagedDeploymentTopologySchema.parse(input)

    // Then: exactly one project is active and its sibling has no runtime.
    expect(parsed.projects[0].runtimeState).toBe(MANAGED_PROJECT_RUNTIME_STATE.ACTIVE)
    expect(parsed.projects[0].workerCount).toBe(2)
    expect(parsed.projects[1]).toMatchObject({
      runtimeState: MANAGED_PROJECT_RUNTIME_STATE.COLD_STANDBY,
      containerCount: 0,
      listenerCount: 0,
      connectionCount: 0,
      automaticRestartEnabled: false,
    })
  })

  it.each([
    [EDGE_ROUTE_MODE.COOLIFY_PROXY, COMPOSITE_ROUTE_PHASE.PROXY_CURRENT_OWNER, COOLIFY_PRODUCTION_OWNER.LEGACY, STEEL_SERVING_TARGET.LEGACY],
    [EDGE_ROUTE_MODE.COOLIFY_PROXY, COMPOSITE_ROUTE_PHASE.PROXY_CURRENT_OWNER, COOLIFY_PRODUCTION_OWNER.MANAGED_BLUE, STEEL_SERVING_TARGET.MANAGED_BLUE],
    [EDGE_ROUTE_MODE.COOLIFY_PROXY, COMPOSITE_ROUTE_PHASE.PROXY_CURRENT_OWNER, COOLIFY_PRODUCTION_OWNER.MANAGED_GREEN, STEEL_SERVING_TARGET.MANAGED_GREEN],
    [EDGE_ROUTE_MODE.MAINTENANCE, COMPOSITE_ROUTE_PHASE.MAINTENANCE_OLD_OWNER, COOLIFY_PRODUCTION_OWNER.LEGACY, STEEL_SERVING_TARGET.MAINTENANCE],
    [EDGE_ROUTE_MODE.MAINTENANCE, COMPOSITE_ROUTE_PHASE.MAINTENANCE_NO_OWNER, COOLIFY_PRODUCTION_OWNER.NONE, STEEL_SERVING_TARGET.MAINTENANCE],
    [EDGE_ROUTE_MODE.MAINTENANCE, COMPOSITE_ROUTE_PHASE.MAINTENANCE_NEW_OWNER, COOLIFY_PRODUCTION_OWNER.MANAGED_BLUE, STEEL_SERVING_TARGET.MAINTENANCE],
  ])("accepts the explicit route tuple %#", (edgeRouteMode, phase, productionOwner, servingTarget) => {
    // Given: a tuple explicitly listed by the serialized route contract.
    const input = {
      edgeRouteMode,
      phase,
      productionOwner,
      ownerObservationCount: productionOwner === COOLIFY_PRODUCTION_OWNER.NONE ? 0 : 1,
      servingTarget,
    }

    // When: the composite route boundary parses it.
    const result = CompositeRouteTupleSchema.safeParse(input)

    // Then: the tuple is accepted without owner inference.
    expect(result.success).toBe(true)
  })

  it("accepts every transition in the closed zero-overlap sequence", () => {
    // Given: the complete approved sequence and verified cutover capacity.
    const transitions = MANAGED_HANDOVER_SEQUENCE.slice(1).map((to, index) => ({
      from: MANAGED_HANDOVER_SEQUENCE[index],
      to,
      ...HANDOVER_RUNTIME_BY_STATE[to],
      capacityStatus: DEPLOYMENT_CAPACITY_STATUS.VERIFIED,
    }))

    // When: every adjacent transition is parsed.
    const results = transitions.map((transition) => HandoverTransitionSchema.safeParse(transition))

    // Then: the full handover is accepted with no simultaneous runtime.
    expect(results.every((result) => result.success)).toBe(true)
    expect(
      transitions.every(
        (transition) =>
          !(transition.activeProjectRuntime.projectRunning && transition.standbyProjectRuntime.projectRunning),
      ),
    ).toBe(true)
  })
})
