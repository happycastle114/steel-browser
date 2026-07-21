import { createHash } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  BUILD_CONTEXT_METHOD,
  IMAGE_PLATFORM,
  RUNTIME_STRATEGY,
  parseRuntimeStrategyReceipt,
  verifyRuntimeStrategyReceipt,
  verifyRuntimeStrategyReceiptBytes,
} from "../src/runtime-strategy-receipt.js"

const SOURCE_REVISION = "a".repeat(40)
const BASE_IMAGE = `ghcr.io/steel-dev/steel-browser@sha256:${"1".repeat(64)}`
const INDEX_DIGEST = `sha256:${"2".repeat(64)}`
const PLATFORM_DIGEST = `sha256:${"3".repeat(64)}`
const CONFIG_DIGEST = `sha256:${"4".repeat(64)}`
const AUDIT_RECEIPT_SHA256 = "6".repeat(64)
const CANDIDATE_IMAGE = `registry.example/steel-worker@${INDEX_DIGEST}`

function receipt(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    strategy: RUNTIME_STRATEGY.UPSTREAM_COMBINED,
    baseImage: BASE_IMAGE,
    buildContextMethod: BUILD_CONTEXT_METHOD.GIT_ARCHIVE,
    buildDigests: [PLATFORM_DIGEST, PLATFORM_DIGEST],
    candidateImage: CANDIDATE_IMAGE,
    candidateIndexDigest: INDEX_DIGEST,
    candidatePlatformDigest: PLATFORM_DIGEST,
    candidateConfigDigest: CONFIG_DIGEST,
    attestationDigests: [`sha256:${"5".repeat(64)}`],
    productionAuditReceiptSha256: AUDIT_RECEIPT_SHA256,
    registryReadbackVerified: true,
    sourceLabelsVerified: true,
    platform: IMAGE_PLATFORM.AMD64,
    sourceDateEpoch: "1773013379",
    sourceRevision: SOURCE_REVISION,
  }
}

const expected = {
  sourceRevision: SOURCE_REVISION,
  upstreamCombinedBaseImage: BASE_IMAGE,
  candidateImage: CANDIDATE_IMAGE,
  platform: IMAGE_PLATFORM.AMD64,
  productionAuditReceiptSha256: AUDIT_RECEIPT_SHA256,
} as const

describe("runtime strategy receipt", () => {
  it("parses strict, immutable publication evidence", () => {
    const parsed = parseRuntimeStrategyReceipt(receipt())
    expect(parsed.candidateConfigDigest).toBe(CONFIG_DIGEST)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(() => parseRuntimeStrategyReceipt({ ...receipt(), selfHash: "forbidden" })).toThrow()
  })

  it("binds the trusted source, base, candidate repo@index, and platform", () => {
    expect(verifyRuntimeStrategyReceipt(receipt(), expected)).toMatchObject({
      candidateImage: CANDIDATE_IMAGE,
      platform: IMAGE_PLATFORM.AMD64,
    })
    for (const mutation of [
      { sourceRevision: "b".repeat(40) },
      { baseImage: `example.test/base@sha256:${"6".repeat(64)}` },
      { candidateImage: `example.test/other@${INDEX_DIGEST}` },
      { platform: IMAGE_PLATFORM.ARM64 },
      { productionAuditReceiptSha256: "7".repeat(64) },
    ]) {
      expect(() => verifyRuntimeStrategyReceipt({ ...receipt(), ...mutation }, expected)).toThrow()
    }
  })

  it("hashes exact raw bytes before parsing", () => {
    const raw = JSON.stringify(receipt())
    const receiptSha256 = createHash("sha256").update(raw).digest("hex")
    expect(verifyRuntimeStrategyReceiptBytes(raw, { ...expected, receiptSha256 })).toMatchObject({
      candidateIndexDigest: INDEX_DIGEST,
    })
    expect(() => verifyRuntimeStrategyReceiptBytes(`${raw}\n`, { ...expected, receiptSha256 })).toThrow("RECEIPT_SHA256")
    expect(() => verifyRuntimeStrategyReceiptBytes("not json", { ...expected, receiptSha256 })).toThrow("RECEIPT_SHA256")
  })

  it.each([
    ["different build subjects", { buildDigests: [PLATFORM_DIGEST, CONFIG_DIGEST] }],
    ["wrong platform subject", { candidatePlatformDigest: CONFIG_DIGEST }],
    ["unbound index", { candidateIndexDigest: CONFIG_DIGEST }],
    ["duplicate attestations", { attestationDigests: [CONFIG_DIGEST, CONFIG_DIGEST] }],
    ["missing attestations", { attestationDigests: [] }],
    ["mutable context", { buildContextMethod: "WORKTREE" }],
    ["no registry proof", { registryReadbackVerified: false }],
    ["no source labels", { sourceLabelsVerified: false }],
  ])("rejects %s", (_name, mutation) => {
    expect(() => parseRuntimeStrategyReceipt({ ...receipt(), ...mutation })).toThrow()
  })

  it("keeps the Playwright fallback non-promotable", () => {
    expect(() => verifyRuntimeStrategyReceipt({
      ...receipt(),
      strategy: RUNTIME_STRATEGY.PLAYWRIGHT_BASE,
      baseImage: `mcr.microsoft.com/playwright@sha256:${"7".repeat(64)}`,
    }, expected)).toThrow("STRATEGY")
  })
})
