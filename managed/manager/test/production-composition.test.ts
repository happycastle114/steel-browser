import {
  MANAGED_RELEASE_EVIDENCE_MODE,
  ManagedReleaseEvidenceSchema,
} from "@happycastle/steel-managed-shared"
import { describe, expect, it } from "vitest"
import { buildVersion } from "../src/runtime/production-composition.js"

const DIGEST = {
  MANAGER_INDEX: `sha256:${"1".repeat(64)}`,
  MANAGER_PLATFORM: `sha256:${"2".repeat(64)}`,
  MANAGER_CONFIG: `sha256:${"3".repeat(64)}`,
  WORKER_INDEX: `sha256:${"4".repeat(64)}`,
  WORKER_PLATFORM: `sha256:${"5".repeat(64)}`,
  WORKER_CONFIG: `sha256:${"6".repeat(64)}`,
} as const

describe("production composition", () => {
  it("binds the public version resource to verified release evidence", () => {
    const evidence = ManagedReleaseEvidenceSchema.parse({
      schemaVersion: 1,
      evidenceMode: MANAGED_RELEASE_EVIDENCE_MODE.CONFIG_FILE,
      body: {
        managerImage: {
          ref: `registry.example/manager@${DIGEST.MANAGER_INDEX}`,
          indexDigest: DIGEST.MANAGER_INDEX,
          platformDigest: DIGEST.MANAGER_PLATFORM,
          configDigest: DIGEST.MANAGER_CONFIG,
        },
        workerImage: {
          ref: `registry.example/worker@${DIGEST.WORKER_INDEX}`,
          indexDigest: DIGEST.WORKER_INDEX,
          platformDigest: DIGEST.WORKER_PLATFORM,
          configDigest: DIGEST.WORKER_CONFIG,
        },
        browserVersion: "150.0.7871.46",
        source: {
          managedRevision: "a".repeat(40),
          upstreamRevision: "b".repeat(40),
          sourceDateEpoch: "1784567890",
        },
        toolchainLockSha256: "7".repeat(64),
        managerProductionAuditReceiptSha256: "8".repeat(64),
        workerProductionAuditReceiptSha256: "9".repeat(64),
        workerRuntimeStrategyReceiptSha256: "a".repeat(64),
        generatedAt: "2026-07-20T17:18:10.000Z",
      },
    })

    const version = buildVersion({
      configSha256: "c".repeat(64),
      createTokenKeyId: "d".repeat(64),
      evidence,
      evidenceSha256: "e".repeat(64),
      startedAt: "2026-07-21T00:00:00.000Z",
    })

    expect(version).toMatchObject({
      browserVersion: evidence.body.browserVersion,
      createTokenKeyId: "d".repeat(16),
      managedSha: evidence.body.source.managedRevision,
      managerDigest: evidence.body.managerImage.indexDigest,
      upstreamSha: evidence.body.source.upstreamRevision,
      workerDigest: evidence.body.workerImage.indexDigest,
    })
  })
})
