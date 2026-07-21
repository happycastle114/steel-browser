import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import managerInitFixture from "../../tests/fixtures/runtime-scope/manager-init.valid.json"
import * as managed from "../src/managed-overlay.js"

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url))
const FIXTURE_CLI_PATH = fileURLToPath(
  new URL("../src/coolify-secret-fixture-cli.ts", import.meta.url),
)

describe("runtime-scope portable proof boundary", () => {
  it.each([
    ["filesystem", { ...managerInitFixture.destinationMount, fileSystemType: "overlay" }],
    ["source", { ...managerInitFixture.destinationMount, source: "none" }],
    ["path", { ...managerInitFixture.destinationMount, mountPoint: "/run/steel-persistent" }],
    [
      "flags",
      { ...managerInitFixture.destinationMount, requiredFlags: ["rw", "nosuid", "nodev"] },
    ],
    [
      "provenance",
      {
        ...managerInitFixture.destinationMount,
        evidenceSource: "PROC_SELF_MOUNTINFO",
        mountInfoObserved: true,
      },
    ],
    ["owner", { ...managerInitFixture.destinationMount, uid: 0 }],
    ["mode", { ...managerInitFixture.destinationMount, mode: 493 }],
    ["size bound", { ...managerInitFixture.destinationMount, sizeBytes: 16_777_216 }],
  ])("rejects destination tmpfs %s drift", (_name, destinationMount) => {
    // Given: an otherwise valid synthetic contract with one destination-mount drift.
    const baseline = managed.ManagerInitContractFixtureSchema.safeParse(managerInitFixture)
    if (!baseline.success) throw baseline.error

    // When: the changed mount contract crosses the portable schema.
    const result = managed.ManagerInitContractFixtureSchema.safeParse({
      ...managerInitFixture,
      destinationMount,
    })

    // Then: persistent, unbounded, or falsely observed storage is rejected.
    expect(result.success).toBe(false)
  })

  it("rejects a missing destination tmpfs contract", () => {
    // Given: a synthetic init fixture with no destination mount declaration.
    const { destinationMount: _destinationMount, ...fixtureInput } = managerInitFixture

    // When: the incomplete fixture crosses the portable schema.
    const result = managed.ManagerInitContractFixtureSchema.safeParse(fixtureInput)

    // Then: a regular file path alone is never accepted as tmpfs proof.
    expect(result.success).toBe(false)
  })

  it("rejects a synthetic execution receipt that claims cleanup occurred", () => {
    // Given: a portable fixture relabeled as a live cleanup execution.
    const fixtureInput = {
      ...managerInitFixture,
      executionReceipt: {
        ...managerInitFixture.executionReceipt,
        cleanupStatus: "COMPLETED",
      },
    }

    // When: the relabeled receipt crosses the portable schema.
    const result = managed.ManagerInitContractFixtureSchema.safeParse(fixtureInput)

    // Then: synthetic verification can only state that cleanup is not applicable.
    expect(result.success).toBe(false)
  })

  it("rejects a synthetic execution receipt that claims live resources", () => {
    // Given: a portable fixture relabeled with one created live resource.
    const fixtureInput = {
      ...managerInitFixture,
      executionReceipt: {
        ...managerInitFixture.executionReceipt,
        liveResourcesCreated: 1,
      },
    }

    // When: the nonzero-resource receipt crosses the portable schema.
    const result = managed.ManagerInitContractFixtureSchema.safeParse(fixtureInput)

    // Then: synthetic verification remains a zero-resource contract.
    expect(result.success).toBe(false)
  })

  it("defers caller-authored live relabels even when they claim Linux provenance", () => {
    // Given: a synthetic fixture whose labels alone claim live Linux proof.
    const fixtureInput = {
      ...managerInitFixture,
      verificationSurface: managed.MANAGER_INIT_VERIFICATION_SURFACE.LIVE_LINUX,
      proofLevel: managed.FINGERPRINT_PROOF_LEVEL.RUNTIME_VERIFIED,
      platform: "LINUX",
    }

    // When: the portable verifier receives the relabeled caller-authored object.
    const result = managed.verifyManagerInitContractFixture({ fixtureInput })

    // Then: no platform relabel can advance the proof beyond CONFIG_BOUND.
    expect(result).toEqual({
      kind: managed.MANAGER_INIT_VERIFICATION_RESULT_KIND.LIVE_PROOF_DEFERRED_TO_TASK_41,
      requestedSurface: managed.MANAGER_INIT_VERIFICATION_SURFACE.LIVE_LINUX,
    })
    expect(managed.ManagerInitContractFixtureSchema.safeParse(fixtureInput).success).toBe(false)
  })

  it("rejects the CLI live-observation path before reading caller-authored JSON", () => {
    // Given: a nonexistent caller-authored live observation path.
    const missingPath = "arbitrary-live-proof.json"

    // When: the real fixture CLI is invoked through its live-mode surface.
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", FIXTURE_CLI_PATH, "--live-observation", missingPath],
      { cwd: REPOSITORY_ROOT, encoding: "utf8" },
    )

    // Then: the typed Task 41 deferral wins before any JSON or runtime claim is read.
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("LIVE_PROOF_DEFERRED_TO_TASK_41")
    expect(result.stderr).not.toContain("ENOENT")
    expect(result.stdout).not.toContain(managed.FINGERPRINT_PROOF_LEVEL.RUNTIME_VERIFIED)
  })
})
