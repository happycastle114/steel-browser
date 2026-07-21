import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"

import { describe, expect, it } from "vitest"

import committedCertificate from "../../runtime-scope.json"
import * as managed from "../src/managed-overlay.js"

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url))

async function loadSourceTexts(): Promise<Readonly<Record<string, string>>> {
  const certificate = managed.RuntimeScopeCertificateSchema.parse(committedCertificate)
  const entries = await Promise.all(
    Object.values(certificate.sourceContracts).map(async ({ path: sourcePath }) => [
      sourcePath,
      await readFile(path.join(REPOSITORY_ROOT, sourcePath), "utf8"),
    ] as const),
  )
  return Object.fromEntries(entries)
}

describe("runtime-scope public contract", () => {
  it("accepts only the committed two-pool static source certificate", () => {
    // Given: the committed source-only certificate with two isolated pools.
    const input = committedCertificate

    // When: the certificate crosses the shared parse boundary.
    const result = managed.RuntimeScopeCertificateSchema.safeParse(input)

    // Then: the exact runtime-independent contract is accepted.
    expect(result.success).toBe(true)
  })

  it.each([
    ["live capacity", { ...committedCertificate, capacityStatus: "VERIFIED" }],
    ["replica discovery", { ...committedCertificate, discoveryMode: "DNS_REPLICA" }],
    ["stale overlay", { ...committedCertificate, overlayPlanSha256: "0".repeat(64) }],
    [
      "worker endpoint drift",
      {
        ...committedCertificate,
        workerPools: [
          {
            ...committedCertificate.workerPools[0],
            staticWorkerEndpoints: [
              "worker-00=http://worker-00:3000",
              "worker-01=http://worker-01:3001",
            ],
          },
          committedCertificate.workerPools[1],
        ],
      },
    ],
    [
      "overlapping pool identity",
      {
        ...committedCertificate,
        workerPools: [committedCertificate.workerPools[0], committedCertificate.workerPools[0]],
      },
    ],
    ["host capacity field", { ...committedCertificate, hostCapacity: { totalMemoryMiB: 1 } }],
  ])("rejects forbidden source mutation %s", (_name, input) => {
    // Given: a source certificate carrying one forbidden live or topology mutation.

    // When: the mutated certificate crosses the parse boundary.
    const result = managed.RuntimeScopeCertificateSchema.safeParse(input)

    // Then: the source boundary fails closed.
    expect(result.success).toBe(false)
  })

  it("verifies every committed source hash without live runtime evidence", async () => {
    // Given: the committed certificate and its fresh-clone source bytes.
    const sourceTexts = await loadSourceTexts()

    // When: the complete source certificate is verified.
    const result = managed.verifyRuntimeScopeCertificate({
      certificateInput: committedCertificate,
      sourceTexts,
    })

    // Then: only the static config-bound source result is returned.
    expect(result).toMatchObject({
      capacityStatus: managed.DEPLOYMENT_CAPACITY_STATUS.UNVERIFIED_UNTIL_TASK_41,
      proofLevel: managed.FINGERPRINT_PROOF_LEVEL.CONFIG_BOUND,
      workerPoolIds: ["managed-blue", "managed-green"],
      scopedWorkerIds: [
        "managed-blue/worker-00",
        "managed-blue/worker-01",
        "managed-green/worker-00",
        "managed-green/worker-01",
      ],
    })
  })

  it("rejects one changed source byte with a typed hash error", async () => {
    // Given: a complete source map with the LICENSE bytes changed.
    const sourceTexts = await loadSourceTexts()
    const mutated = { ...sourceTexts, LICENSE: `${sourceTexts["LICENSE"] ?? ""}x` }

    // When: the changed source is verified against the committed certificate.
    const verify = () => managed.verifyRuntimeScopeCertificate({
      certificateInput: committedCertificate,
      sourceTexts: mutated,
    })

    // Then: the verifier reports source drift rather than accepting a relabeled result.
    expect(verify).toThrowError(managed.RuntimeScopeVerificationError)
    expect(verify).toThrow("source hash drift: LICENSE")
  })
})
