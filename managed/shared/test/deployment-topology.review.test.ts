import { fileURLToPath } from "node:url"

import * as ts from "typescript"
import { describe, expect, it } from "vitest"

import {
  CAPACITY_GATE_OUTCOME,
  CAPACITY_PHASE,
  DEPLOYMENT_CAPACITY_STATUS,
  DISK_CAPACITY_STAGE,
  INODE_CAPACITY_STAGE,
  MANAGED_DEPLOYMENT_CONFIG,
  MANAGED_HANDOVER_STATE,
  ManagedDeploymentTopologySchema,
  evaluateCpuCapacity,
  evaluateDiskCapacity,
  evaluateInodeCapacity,
  evaluateMemoryCapacity,
  HandoverTransitionSchema,
} from "../src/managed-overlay.js"
import { findRawStateComparisons } from "../src/raw-state-comparison.js"
import { activeProject, coldProject, validTopology } from "./deployment-topology-fixtures.js"

const MIB = 1_048_576
const GIB = 1_073_741_824

const RUNNING_RUNTIME_PROOF = {
  projectRunning: true,
  containerCount: MANAGED_DEPLOYMENT_CONFIG.activeContainerCount,
  listenerCount: MANAGED_DEPLOYMENT_CONFIG.activeListenerCount,
  listeners: MANAGED_DEPLOYMENT_CONFIG.activeListeners,
  connectionCount: 0,
} as const

const STOPPED_RUNTIME_PROOF = {
  projectRunning: false,
  containerCount: 0,
  listenerCount: 0,
  listeners: [],
  connectionCount: 0,
} as const

describe("deployment topology review regressions", () => {
  it("rejects any active listener count other than the canonical inventory length", () => {
    // Given: a stable topology whose active project is missing one listener.
    const input = {
      ...validTopology(),
      projects: [
        { ...activeProject(), listenerCount: MANAGED_DEPLOYMENT_CONFIG.activeListenerCount - 1 },
        coldProject(),
      ],
    }

    // When: the topology boundary parses the observation.
    const result = ManagedDeploymentTopologySchema.safeParse(input)

    // Then: listener drift cannot enter the canonical active state.
    expect(result.success).toBe(false)
  })

  it("carries exact running listener proof through the handover boundary", () => {
    // Given: an adjacent transition with exact active and stopped sibling observations.
    const transition = {
      from: MANAGED_HANDOVER_STATE.ACTIVE_DRAIN_SAFE,
      to: MANAGED_HANDOVER_STATE.EDGE_MAINTENANCE,
      activeProjectRuntime: RUNNING_RUNTIME_PROOF,
      standbyProjectRuntime: STOPPED_RUNTIME_PROOF,
      capacityStatus: DEPLOYMENT_CAPACITY_STATUS.VERIFIED,
    }

    // When: exact and listener-drift observations cross the boundary.
    const results = [
      HandoverTransitionSchema.safeParse(transition),
      HandoverTransitionSchema.safeParse({
        ...transition,
        activeProjectRuntime: { ...RUNNING_RUNTIME_PROOF, listenerCount: 3 },
      }),
    ]

    // Then: only the exact running proof is accepted.
    expect(results.map((result) => result.success)).toEqual([true, false])
  })

  it("requires zero containers listeners and connections in a stopped handover proof", () => {
    // Given: the stop-before-start transition and each possible nonzero stopped fact.
    const transition = {
      from: MANAGED_HANDOVER_STATE.EDGE_MAINTENANCE,
      to: MANAGED_HANDOVER_STATE.ACTIVE_STOPPED,
      activeProjectRuntime: STOPPED_RUNTIME_PROOF,
      standbyProjectRuntime: STOPPED_RUNTIME_PROOF,
      capacityStatus: DEPLOYMENT_CAPACITY_STATUS.VERIFIED,
    }
    const mutations = [
      { ...STOPPED_RUNTIME_PROOF, containerCount: 1 },
      { ...STOPPED_RUNTIME_PROOF, listenerCount: 1 },
      { ...STOPPED_RUNTIME_PROOF, connectionCount: 1 },
    ]

    // When: the exact proof and every mutation cross the transition boundary.
    const results = [
      HandoverTransitionSchema.safeParse(transition),
      ...mutations.map((activeProjectRuntime) =>
        HandoverTransitionSchema.safeParse({ ...transition, activeProjectRuntime }),
      ),
    ]

    // Then: only the all-zero stopped proof is accepted.
    expect(results.map((result) => result.success)).toEqual([true, false, false, false])
  })

  it("blocks fractional host logical CPU counts as invalid measurement", () => {
    // Given: a fractional host count whose inflated allowances otherwise pass.
    const input = {
      phase: CAPACITY_PHASE.DISPOSABLE_CANARY,
      hostLogicalCpuCount: 4.9,
      hostNonSteelCpuP95Cores: 1,
      legacySteelCpuP95Cores: 0,
      managedCpuP95Cores: 2.7,
      loadOneP95: 3.9,
      usableSamples: 300,
      sampleWindowSeconds: 300,
      sampleIntervalSeconds: 1,
      throttling: [
        { nrThrottled: 5, nrPeriods: 100 },
        { nrThrottled: 5, nrPeriods: 100 },
        { nrThrottled: 5, nrPeriods: 100 },
      ],
    }

    // When: the CPU capacity boundary evaluates it.
    const result = evaluateCpuCapacity(input)

    // Then: malformed count data blocks measurement rather than verifying capacity.
    expect(result.outcome).toBe(CAPACITY_GATE_OUTCOME.BLOCKED_MEASUREMENT)
  })

  it("accepts minimal production-serial memory and CPU observations", () => {
    // Given: formula-complete serial observations without legacy-only measurements.
    const memory = {
      phase: CAPACITY_PHASE.PRODUCTION_SERIAL,
      hostTotalMemoryMiB: 2_423,
      hostNonSteelP95MiB: 0,
      managerLimitBytes: 100 * MIB,
      workerLimitBytes: 100 * MIB,
      usableSamples: 300,
      sampleWindowSeconds: 300,
      sampleIntervalSeconds: 1,
    }
    const cpu = {
      phase: CAPACITY_PHASE.PRODUCTION_SERIAL,
      hostLogicalCpuCount: 4,
      hostNonSteelCpuP95Cores: 1,
      managedCpuP95Cores: 2,
      loadOneP95: 3.2,
      usableSamples: 300,
      sampleWindowSeconds: 300,
      sampleIntervalSeconds: 1,
      throttling: [
        { nrThrottled: 5, nrPeriods: 100 },
        { nrThrottled: 5, nrPeriods: 100 },
        { nrThrottled: 5, nrPeriods: 100 },
      ],
    }

    // When: both phase-local observations are evaluated.
    const outcomes = [evaluateMemoryCapacity(memory), evaluateCpuCapacity(cpu)]

    // Then: neither requires an irrelevant legacy measurement.
    expect(outcomes.map((result) => result.outcome)).toEqual([
      CAPACITY_GATE_OUTCOME.VERIFIED,
      CAPACITY_GATE_OUTCOME.VERIFIED,
    ])
  })

  it("accepts minimal after-start disk and inode observations", () => {
    // Given: formula-complete after-start observations without pre-pull image fields.
    const disk = {
      stage: DISK_CAPACITY_STAGE.AFTER_START,
      freeDiskBytes: 6 * GIB,
      filesystemBytes: 30 * GIB,
    }
    const inodes = {
      stage: INODE_CAPACITY_STAGE.AFTER_START,
      freeInodes: 200_000,
      totalInodes: 2_000_000,
    }

    // When: both stage-local observations are evaluated.
    const outcomes = [evaluateDiskCapacity(disk), evaluateInodeCapacity(inodes)]

    // Then: neither requires irrelevant pre-pull measurements.
    expect(outcomes.map((result) => result.outcome)).toEqual([
      CAPACITY_GATE_OUTCOME.VERIFIED,
      CAPACITY_GATE_OUTCOME.VERIFIED,
    ])
  })

  it.each([
    ["phase", "DISPOSABLE_CANARY"],
    ["phase", "PRODUCTION_SERIAL"],
    ["stage", "BEFORE_PULLS"],
    ["stage", "AFTER_START"],
  ] as const)("detects raw capacity %s member %s independently of the production list", (variable, member) => {
    // Given: a direct comparison against one independently listed closed capacity member.
    const source = `declare const ${variable}: string; export const result = ${variable} === ${JSON.stringify(member)}`

    // When: the AST boundary scans the independent fixture.
    const violations = findRawStateComparisons(source, "capacity-state-fixture.ts")

    // Then: no phase or stage family can be omitted from the canonical scan set.
    expect(violations.map((violation) => violation.member)).toEqual([member])
  })

  it("exports deeply readonly parsed topology and capacity shapes", () => {
    // Given: a compiler fixture that attempts four nested mutations on parsed exports.
    const fixturePath = fileURLToPath(
      new URL("../../tests/fixtures/readonly-parsed-contract.ts", import.meta.url),
    )
    const program = ts.createProgram({
      rootNames: [fixturePath],
      options: {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        noEmit: true,
        skipLibCheck: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
      },
    })

    // When: TypeScript checks the consumer fixture against the exported contracts.
    const diagnosticCodes = ts
      .getPreEmitDiagnostics(program)
      .filter((diagnostic) => diagnostic.file?.fileName === fixturePath)
      .map((diagnostic) => diagnostic.code)

    // Then: all four nested mutations fail as readonly assignments.
    expect(diagnosticCodes).toEqual([2540, 2540, 2540, 2540])
  })
})
