import { describe, expect, it } from "vitest"

import managerInitFixture from "../../tests/fixtures/runtime-scope/manager-init.valid.json"
import * as managed from "../src/managed-overlay.js"

describe("runtime-scope manager init contract", () => {
  it("accepts the synthetic manager-init expected contract without claiming live proof", () => {
    // Given: the committed final-shape synthetic contract fixture.
    const input = {
      fixtureInput: managerInitFixture,
    }

    // When: the portable contract verifier evaluates it.
    const result = managed.verifyManagerInitContractFixture(input)

    // Then: it returns CONFIG_BOUND with the exact non-root steady state.
    expect(result).toEqual({
      kind: managed.MANAGER_INIT_VERIFICATION_RESULT_KIND.CONFIG_BOUND,
      verificationSurface: managed.MANAGER_INIT_VERIFICATION_SURFACE.SYNTHETIC_CONTRACT,
      proofLevel: managed.FINGERPRINT_PROOF_LEVEL.CONFIG_BOUND,
      initialUid: 0,
      finalUid: 10001,
      finalGid: 10001,
      capabilityFields: ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"],
      secretDescriptorsClosed: true,
      destinationMount: managerInitFixture.destinationMount,
      executionReceipt: managerInitFixture.executionReceipt,
    })
  })

  it.each([
    [
      "parsed compose",
      { ...managerInitFixture, compose: { ...managerInitFixture.compose, deploymentMode: "PARSED" } },
    ],
    [
      "generated service env",
      { ...managerInitFixture, compose: { ...managerInitFixture.compose, generatedServiceEnvFile: true } },
    ],
    [
      "secret env",
      {
        ...managerInitFixture,
        compose: {
          ...managerInitFixture.compose,
          serviceEnvironmentKeys: {
            ...managerInitFixture.compose.serviceEnvironmentKeys,
            manager: ["STEEL_MANAGED_CREATE_TOKEN_KEY_HEX"],
          },
        },
      },
    ],
    [
      "nonroot init",
      { ...managerInitFixture, initialProcess: { ...managerInitFixture.initialProcess, uid: 10001 } },
    ],
    [
      "missing setpcap",
      {
        ...managerInitFixture,
        initialProcess: {
          ...managerInitFixture.initialProcess,
          capabilities: ["CHOWN", "SETUID", "SETGID"],
        },
      },
    ],
    [
      "source directory traversable",
      {
        ...managerInitFixture,
        secretSource: { ...managerInitFixture.secretSource, directoryMode: 493 },
      },
    ],
    [
      "source missing cloexec",
      {
        ...managerInitFixture,
        openRecords: [
          {
            ...managerInitFixture.openRecords[0],
            flags: ["O_RDONLY", "O_NOFOLLOW"],
          },
          managerInitFixture.openRecords[1],
        ],
      },
    ],
    [
      "destination missing cloexec",
      {
        ...managerInitFixture,
        openRecords: [
          managerInitFixture.openRecords[0],
          {
            ...managerInitFixture.openRecords[1],
            flags: ["O_WRONLY", "O_CREAT", "O_EXCL", "O_NOFOLLOW"],
          },
        ],
      },
    ],
    [
      "inherited secret descriptor",
      {
        ...managerInitFixture,
        fdScans: {
          ...managerInitFixture.fdScans,
          beforePrivilegeDrop: {
            ...managerInitFixture.fdScans.beforePrivilegeDrop,
            secretPathMatches: 1,
          },
        },
      },
    ],
    [
      "unclassified descriptor",
      {
        ...managerInitFixture,
        fdScans: {
          ...managerInitFixture.fdScans,
          afterPrivilegeDrop: {
            ...managerInitFixture.fdScans.afterPrivilegeDrop,
            unclassifiedDescriptors: 1,
          },
        },
      },
    ],
    [
      "wrong drop order",
      {
        ...managerInitFixture,
        initTrace: [
          ...managerInitFixture.initTrace.slice(0, 9),
          managerInitFixture.initTrace[10],
          managerInitFixture.initTrace[9],
          ...managerInitFixture.initTrace.slice(11),
        ],
      },
    ],
    [
      "supplementary group",
      {
        ...managerInitFixture,
        finalStatus: { ...managerInitFixture.finalStatus, supplementaryGroups: [10001] },
      },
    ],
    [
      "no new privs disabled",
      {
        ...managerInitFixture,
        finalStatus: { ...managerInitFixture.finalStatus, noNewPrivs: 0 },
      },
    ],
    [
      "worker mount",
      {
        ...managerInitFixture,
        leakScan: { ...managerInitFixture.leakScan, workerMountMatches: 1 },
      },
    ],
  ])("rejects init mutation %s", (_name, fixtureInput) => {
    // Given: a final-shape fixture carrying one security mutation.

    // When: the mutated observation crosses the schema.
    const result = managed.ManagerInitContractFixtureSchema.safeParse(fixtureInput)

    // Then: the init boundary fails closed.
    expect(result.success).toBe(false)
  })

  it.each(managed.REQUIRED_MANAGER_STATUS_CAP_FIELDS)(
    "rejects nonzero final capability %s",
    (capabilityField) => {
      // Given: one nonzero final capability set.
      const fixtureInput = {
        ...managerInitFixture,
        finalStatus: {
          ...managerInitFixture.finalStatus,
          capabilities: {
            ...managerInitFixture.finalStatus.capabilities,
            [capabilityField]: "0000000000000001",
          },
        },
      }

      // When: the capability observation crosses the schema.
      const result = managed.ManagerInitContractFixtureSchema.safeParse(fixtureInput)

      // Then: every capability field must remain all-zero.
      expect(result.success).toBe(false)
    },
  )

})
