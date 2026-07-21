import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  BUILD_CONTEXT_METHOD,
  IMAGE_PLATFORM,
  RUNTIME_STRATEGY,
  verifyRuntimeStrategyReceipt,
  verifyRuntimeStrategyReceiptBytes,
} from "../src/runtime-strategy-gate.js"
import { MANAGED_WORKER_IMAGE_INPUT } from "../src/image-policy.js"

const SOURCE_REVISION = "a".repeat(40)
const DIGEST = `sha256:${"b".repeat(64)}`
const INDEX_DIGEST = `sha256:${"c".repeat(64)}`
const AUDIT_SHA256 = "f".repeat(64)
const CANDIDATE_IMAGE = `registry.example/steel-worker@${INDEX_DIGEST}`

function receipt(): Record<string, unknown> {
  return {
    baseImage: MANAGED_WORKER_IMAGE_INPUT.UPSTREAM_IMAGE,
    attestationDigests: [`sha256:${"d".repeat(64)}`],
    buildContextMethod: BUILD_CONTEXT_METHOD.GIT_ARCHIVE,
    buildDigests: [DIGEST, DIGEST],
    candidateConfigDigest: `sha256:${"e".repeat(64)}`,
    candidateImage: CANDIDATE_IMAGE,
    candidateIndexDigest: INDEX_DIGEST,
    candidatePlatformDigest: DIGEST,
    platform: IMAGE_PLATFORM.AMD64,
    productionAuditReceiptSha256: AUDIT_SHA256,
    registryReadbackVerified: true,
    schemaVersion: 1,
    sourceLabelsVerified: true,
    sourceDateEpoch: "1773013379",
    sourceRevision: SOURCE_REVISION,
    strategy: RUNTIME_STRATEGY.UPSTREAM_COMBINED,
  }
}

function expected() {
  return {
    candidateImage: CANDIDATE_IMAGE,
    platform: IMAGE_PLATFORM.AMD64,
    productionAuditReceiptSha256: AUDIT_SHA256,
    sourceRevision: SOURCE_REVISION,
    upstreamCombinedBaseImage: MANAGED_WORKER_IMAGE_INPUT.UPSTREAM_IMAGE,
  }
}

describe("runtime strategy promotion gate", () => {
  it("accepts two clean git-archive builds with the same subject digest", () => {
    expect(verifyRuntimeStrategyReceipt(receipt(), expected())).toMatchObject({
      buildDigests: [DIGEST, DIGEST],
      strategy: RUNTIME_STRATEGY.UPSTREAM_COMBINED,
    })
  })

  it("verifies the exact receipt bytes before parsing promotion evidence", () => {
    const raw = JSON.stringify(receipt())
    const expectedSha256 = createHash("sha256").update(raw).digest("hex")

    expect(
      verifyRuntimeStrategyReceiptBytes(raw, { ...expected(), receiptSha256: expectedSha256 }),
    ).toMatchObject({ candidateIndexDigest: INDEX_DIGEST })
    expect(() =>
      verifyRuntimeStrategyReceiptBytes(
        `${raw}\n`,
        { ...expected(), receiptSha256: expectedSha256 },
      ),
    ).toThrow("RECEIPT_SHA256")
  })

  it.each([
    ["different build digest", { buildDigests: [DIGEST, `sha256:${"c".repeat(64)}`] }],
    ["wrong source", { sourceRevision: "d".repeat(40) }],
    ["floating base", { baseImage: "ghcr.io/steel-dev/steel-browser:main" }],
    ["mutable context", { buildContextMethod: "WORKTREE" }],
    ["unpublished index", { candidateIndexDigest: `sha256:${"f".repeat(64)}` }],
    ["wrong platform subject", { candidatePlatformDigest: INDEX_DIGEST }],
    ["missing attestations", { attestationDigests: [] }],
    ["no registry readback", { registryReadbackVerified: false }],
    ["unverified labels", { sourceLabelsVerified: false }],
  ])("rejects %s", (_name, mutation) => {
    expect(() =>
      verifyRuntimeStrategyReceipt({ ...receipt(), ...mutation }, expected()),
    ).toThrow()
  })

  it("keeps the Playwright fallback blocked until a reviewed base and checksum land", () => {
    expect(() =>
      verifyRuntimeStrategyReceipt(
        {
          ...receipt(),
          baseImage: `mcr.microsoft.com/playwright@sha256:${"c".repeat(64)}`,
          strategy: RUNTIME_STRATEGY.PLAYWRIGHT_BASE,
        },
        expected(),
      ),
    ).toThrow()
  })

  it("rejects a different production audit receipt", () => {
    expect(() => verifyRuntimeStrategyReceipt(receipt(), {
      ...expected(),
      productionAuditReceiptSha256: "0".repeat(64),
    })).toThrow()
  })
})
