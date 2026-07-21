import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { test } from "node:test"

import {
  buildReleaseEvidence,
  serializeReleaseEvidence,
} from "../release-evidence.mjs"

const digest = (character) => `sha256:${character.repeat(64)}`
const sha = (character) => character.repeat(64)

test("builds deterministic release evidence from registry readback receipts", () => {
  const evidence = buildReleaseEvidence({
    browserVersion: "150.0.7871.46",
    managerReceipt: {
      candidateConfigDigest: digest("3"),
      candidateImage: `ghcr.io/happycastle114/steel-managed-manager@${digest("1")}`,
      candidateIndexDigest: digest("1"),
      candidatePlatformDigest: digest("2"),
      productionAuditReceiptSha256: sha("4"),
      sourceDateEpoch: "1784567890",
      sourceRevision: "a".repeat(40),
    },
    toolchainLockSha256: sha("5"),
    upstreamRevision: "b".repeat(40),
    workerReceipt: {
      candidateConfigDigest: digest("8"),
      candidateImage: `ghcr.io/happycastle114/steel-managed-worker@${digest("6")}`,
      candidateIndexDigest: digest("6"),
      candidatePlatformDigest: digest("7"),
      productionAuditReceiptSha256: sha("9"),
      sourceDateEpoch: "1784567890",
      sourceRevision: "a".repeat(40),
    },
    workerRuntimeStrategyReceiptSha256: sha("c"),
  })
  const serialized = serializeReleaseEvidence(evidence)

  assert.equal(evidence.evidenceMode, "CONFIG_FILE")
  assert.equal(evidence.body.generatedAt, new Date(1_784_567_890_000).toISOString())
  assert.equal(evidence.body.managerImage.indexDigest, digest("1"))
  assert.equal(evidence.body.workerImage.indexDigest, digest("6"))
  assert.equal(serialized.includes("\n"), false)
  assert.equal(createHash("sha256").update(serialized).digest("hex").length, 64)
})

test("rejects source drift and unpinned release receipts", () => {
  const base = {
    browserVersion: "150.0.7871.46",
    managerReceipt: {
      candidateConfigDigest: digest("3"),
      candidateImage: `ghcr.io/example/manager@${digest("1")}`,
      candidateIndexDigest: digest("1"),
      candidatePlatformDigest: digest("2"),
      productionAuditReceiptSha256: sha("4"),
      sourceDateEpoch: "1784567890",
      sourceRevision: "a".repeat(40),
    },
    toolchainLockSha256: sha("5"),
    upstreamRevision: "b".repeat(40),
    workerReceipt: {
      candidateConfigDigest: digest("8"),
      candidateImage: `ghcr.io/example/worker@${digest("6")}`,
      candidateIndexDigest: digest("6"),
      candidatePlatformDigest: digest("7"),
      productionAuditReceiptSha256: sha("9"),
      sourceDateEpoch: "1784567890",
      sourceRevision: "a".repeat(40),
    },
    workerRuntimeStrategyReceiptSha256: sha("c"),
  }

  assert.throws(() => buildReleaseEvidence({
    ...base,
    workerReceipt: { ...base.workerReceipt, sourceRevision: "d".repeat(40) },
  }))
  assert.throws(() => buildReleaseEvidence({
    ...base,
    managerReceipt: { ...base.managerReceipt, candidateImage: "manager:latest" },
  }))
})
