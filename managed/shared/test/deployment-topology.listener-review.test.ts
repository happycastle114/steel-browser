import { describe, expect, it } from "vitest"

import {
  DEPLOYMENT_CAPACITY_STATUS,
  HANDOVER_RUNTIME_BY_STATE,
  MANAGED_DEPLOYMENT_CONFIG,
  MANAGED_HANDOVER_SEQUENCE,
  MANAGED_HANDOVER_STATE,
  HandoverTransitionSchema,
  ManagedDeploymentTopologySchema,
} from "../src/managed-overlay.js"
import { findRawStateComparisons } from "../src/raw-state-comparison.js"
import { activeProject, coldProject, validTopology } from "./deployment-topology-fixtures.js"

const EXPECTED_ACTIVE_LISTENERS = [
  {
    id: "MANAGER_PUBLIC_API",
    containerRole: "MANAGER",
    role: "PUBLIC_API",
    bindScope: "0.0.0.0",
    port: 3_000,
    publication: "TRAEFIK_PROXY_ONLY",
  },
  {
    id: "MANAGER_LOOPBACK_HEALTH",
    containerRole: "MANAGER",
    role: "HEALTH",
    bindScope: "127.0.0.1",
    port: 3_001,
    publication: "UNPUBLISHED",
  },
  {
    id: "WORKER_SUPERVISOR",
    containerRole: "WORKER",
    role: "SUPERVISOR",
    bindScope: "0.0.0.0",
    port: 3_000,
    publication: "PRIVATE_PROJECT_ONLY",
  },
  {
    id: "WORKER_LOOPBACK_UPSTREAM",
    containerRole: "WORKER",
    role: "UPSTREAM",
    bindScope: "127.0.0.1",
    port: 3_001,
    publication: "UNPUBLISHED",
  },
] as const

const EXPOSED_DEBUG_REPLACEMENT = [
  ...EXPECTED_ACTIVE_LISTENERS.slice(0, 3),
  {
    ...EXPECTED_ACTIVE_LISTENERS[3],
    bindScope: "0.0.0.0",
    port: 9_223,
    publication: "TRAEFIK_PROXY_ONLY",
  },
] as const

const STOPPED_RUNTIME_PROOF = {
  projectRunning: false,
  containerCount: 0,
  listenerCount: 0,
  listeners: [],
  connectionCount: 0,
} as const

describe("deployment topology listener and handover review regressions", () => {
  it("derives four active listener definitions from the independent manager and worker inventory", () => {
    // Given: the governing plan's independently enumerated manager and worker listener roles.
    const expectedListenerCount = EXPECTED_ACTIVE_LISTENERS.length

    // When: the canonical summary count is read.
    const actualListenerCount = MANAGED_DEPLOYMENT_CONFIG.activeListenerCount

    // Then: the scalar summary is derived from all four exact definitions.
    expect(actualListenerCount).toBe(expectedListenerCount)
  })

  it("accepts only the exact active listener identities and rejects a same-count public 9223 replacement", () => {
    // Given: exact and same-count replacement observations with independently specified listeners.
    const exact = {
      ...validTopology(),
      projects: [
        {
          ...activeProject(),
          listenerCount: EXPECTED_ACTIVE_LISTENERS.length,
          listeners: EXPECTED_ACTIVE_LISTENERS,
        },
        { ...coldProject(), listeners: [] },
      ],
    }
    const replacement = {
      ...exact,
      projects: [{ ...exact.projects[0], listeners: EXPOSED_DEBUG_REPLACEMENT }, exact.projects[1]],
    }

    // When: both four-listener observations cross the topology boundary.
    const results = [
      ManagedDeploymentTopologySchema.safeParse(exact),
      ManagedDeploymentTopologySchema.safeParse(replacement),
    ]

    // Then: the exact inventory passes and the exposed debug replacement fails closed.
    expect(results.map((result) => result.success)).toEqual([true, false])
  })

  it("carries the exact listener inventory through the running handover proof", () => {
    // Given: an adjacent transition with the exact inventory and a same-count exposed replacement.
    const exact = {
      from: MANAGED_HANDOVER_STATE.ACTIVE_DRAIN_SAFE,
      to: MANAGED_HANDOVER_STATE.EDGE_MAINTENANCE,
      activeProjectRuntime: {
        projectRunning: true,
        containerCount: 3,
        listenerCount: EXPECTED_ACTIVE_LISTENERS.length,
        listeners: EXPECTED_ACTIVE_LISTENERS,
        connectionCount: 0,
      },
      standbyProjectRuntime: STOPPED_RUNTIME_PROOF,
      capacityStatus: DEPLOYMENT_CAPACITY_STATUS.VERIFIED,
    }
    const replacement = {
      ...exact,
      activeProjectRuntime: {
        ...exact.activeProjectRuntime,
        listeners: EXPOSED_DEBUG_REPLACEMENT,
      },
    }

    // When: both observations cross the handover boundary.
    const results = [HandoverTransitionSchema.safeParse(exact), HandoverTransitionSchema.safeParse(replacement)]

    // Then: identity, container, bind, port, and publication all remain exact during handover.
    expect(results.map((result) => result.success)).toEqual([true, false])
  })

  it("rejects connection count 99 on either project for every handover transition", () => {
    // Given: every adjacent transition with either target-state connection proof changed to 99.
    const mutations = MANAGED_HANDOVER_SEQUENCE.slice(1).flatMap((to, index) => {
      const transition = {
        from: MANAGED_HANDOVER_SEQUENCE[index],
        to,
        ...HANDOVER_RUNTIME_BY_STATE[to],
        capacityStatus: DEPLOYMENT_CAPACITY_STATUS.VERIFIED,
      }
      return [
        {
          ...transition,
          activeProjectRuntime: {
            ...transition.activeProjectRuntime,
            connectionCount: 99,
          },
        },
        {
          ...transition,
          standbyProjectRuntime: {
            ...transition.standbyProjectRuntime,
            connectionCount: 99,
          },
        },
      ]
    })

    // When: all eighteen counterexamples cross the transition boundary.
    const results = mutations.map((mutation) => HandoverTransitionSchema.safeParse(mutation))

    // Then: no transition accepts a connection fact that differs from its target-state proof.
    expect(results.every((result) => !result.success)).toBe(true)
  })

  it.each([
    "MANAGER_PUBLIC_API",
    "MANAGER_LOOPBACK_HEALTH",
    "WORKER_SUPERVISOR",
    "WORKER_LOOPBACK_UPSTREAM",
    "MANAGER",
    "WORKER",
    "PUBLIC_API",
    "HEALTH",
    "SUPERVISOR",
    "UPSTREAM",
    "0.0.0.0",
    "127.0.0.1",
    "TRAEFIK_PROXY_ONLY",
    "PRIVATE_PROJECT_ONLY",
    "UNPUBLISHED",
  ] as const)("detects raw listener vocabulary member %s independently", (member) => {
    // Given: a direct comparison against one independently listed closed listener member.
    const source = `declare const value: string; export const result = value === ${JSON.stringify(member)}`

    // When: the raw-state boundary scans the independent fixture.
    const violations = findRawStateComparisons(source, "listener-state-fixture.ts")

    // Then: every listener identity and exposure member is protected from raw comparison.
    expect(violations.map((violation) => violation.member)).toEqual([member])
  })
})
