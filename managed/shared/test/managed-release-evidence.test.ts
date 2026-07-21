import { createHash } from "node:crypto"

import { describe, expect, it } from "vitest"

import { canonicalJson } from "../src/canonical-json.js"
import {
  MANAGED_RELEASE_EVIDENCE_MODE,
  MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD,
  ManagedReleaseEvidenceMismatchError,
  parseManagedReleaseEvidence,
  verifyManagedReleaseEvidenceBytes,
} from "../src/index.js"

const DIGEST = {
  MANAGER_INDEX: `sha256:${"1".repeat(64)}`,
  MANAGER_PLATFORM: `sha256:${"2".repeat(64)}`,
  MANAGER_CONFIG: `sha256:${"3".repeat(64)}`,
  WORKER_INDEX: `sha256:${"4".repeat(64)}`,
  WORKER_PLATFORM: `sha256:${"5".repeat(64)}`,
  WORKER_CONFIG: `sha256:${"6".repeat(64)}`,
} as const
const MANAGER_IMAGE_REF = `registry.example/steel-manager@${DIGEST.MANAGER_INDEX}`
const WORKER_IMAGE_REF = `registry.example/steel-worker@${DIGEST.WORKER_INDEX}`
const BROWSER_VERSION = "140.0.7339.16"
const SOURCE = {
  managedRevision: "a".repeat(40),
  upstreamRevision: "b".repeat(40),
  sourceDateEpoch: "1784567890",
} as const
const TOOLCHAIN_LOCK_SHA256 = "7".repeat(64)
const MANAGER_AUDIT_RECEIPT_SHA256 = "8".repeat(64)
const WORKER_AUDIT_RECEIPT_SHA256 = "9".repeat(64)
const WORKER_STRATEGY_RECEIPT_SHA256 = "a".repeat(64)

function evidence() {
  return {
    schemaVersion: 1,
    evidenceMode: MANAGED_RELEASE_EVIDENCE_MODE.CONFIG_FILE,
    body: {
      managerImage: {
        ref: MANAGER_IMAGE_REF,
        indexDigest: DIGEST.MANAGER_INDEX,
        platformDigest: DIGEST.MANAGER_PLATFORM,
        configDigest: DIGEST.MANAGER_CONFIG,
      },
      workerImage: {
        ref: WORKER_IMAGE_REF,
        indexDigest: DIGEST.WORKER_INDEX,
        platformDigest: DIGEST.WORKER_PLATFORM,
        configDigest: DIGEST.WORKER_CONFIG,
      },
      browserVersion: BROWSER_VERSION,
      source: SOURCE,
      toolchainLockSha256: TOOLCHAIN_LOCK_SHA256,
      managerProductionAuditReceiptSha256: MANAGER_AUDIT_RECEIPT_SHA256,
      workerProductionAuditReceiptSha256: WORKER_AUDIT_RECEIPT_SHA256,
      workerRuntimeStrategyReceiptSha256: WORKER_STRATEGY_RECEIPT_SHA256,
      generatedAt: "2026-07-20T17:18:10.000Z",
    },
  }
}

function canonicalBytes(input: unknown = evidence()): string {
  return `${canonicalJson(input)}\n`
}

function expected(rawBytes: string | Uint8Array) {
  const bytes = typeof rawBytes === "string" ? Buffer.from(rawBytes, "utf8") : Buffer.from(rawBytes)
  return {
    releaseEvidenceSha256: createHash("sha256").update(bytes).digest("hex"),
    managerImageRef: MANAGER_IMAGE_REF,
    workerImageRef: WORKER_IMAGE_REF,
    browserVersion: BROWSER_VERSION,
    source: SOURCE,
    toolchainLockSha256: TOOLCHAIN_LOCK_SHA256,
    managerProductionAuditReceiptSha256: MANAGER_AUDIT_RECEIPT_SHA256,
    workerProductionAuditReceiptSha256: WORKER_AUDIT_RECEIPT_SHA256,
    workerRuntimeStrategyReceiptSha256: WORKER_STRATEGY_RECEIPT_SHA256,
  }
}

describe("managed release evidence schema", () => {
  it("parses the exact immutable CONFIG_FILE shape", () => {
    // Given: host- and phase-independent release evidence.
    const input = evidence()

    // When: the publication contract parses it.
    const parsed = parseManagedReleaseEvidence(input)

    // Then: only the config-file evidence body is retained and frozen.
    expect(parsed.evidenceMode).toBe(MANAGED_RELEASE_EVIDENCE_MODE.CONFIG_FILE)
    expect(parsed.body.managerImage.ref).toBe(MANAGER_IMAGE_REF)
    expect(Object.isFrozen(parsed.body.source)).toBe(true)
  })

  it.each([
    ["self hash", { ...evidence(), releaseEvidenceSha256: "0".repeat(64) }],
    ["phase", { ...evidence(), phase: "CANDIDATE_QUALIFICATION" }],
    ["host", { ...evidence(), body: { ...evidence().body, host: "steel.example" } }],
    ["legacy owner", { ...evidence(), body: { ...evidence().body, legacyProductionOwnerRunning: false } }],
    ["singular audit receipt", { ...evidence(), body: { ...evidence().body, productionAuditReceiptSha256: "c".repeat(64) } }],
    ["singular strategy receipt", { ...evidence(), body: { ...evidence().body, runtimeStrategyReceiptSha256: "d".repeat(64) } }],
  ])("rejects forbidden %s ownership", (_name, input) => {
    // Given: an otherwise valid receipt contaminated with routing or self-hash state.
    // When: the strict schema parses it.
    const parse = () => parseManagedReleaseEvidence(input)

    // Then: the non-release field is rejected.
    expect(parse).toThrow()
  })

  it.each([
    ["manager index binding", { ...evidence(), body: { ...evidence().body, managerImage: { ...evidence().body.managerImage, indexDigest: `sha256:${"c".repeat(64)}` } } }],
    ["worker index binding", { ...evidence(), body: { ...evidence().body, workerImage: { ...evidence().body.workerImage, indexDigest: `sha256:${"d".repeat(64)}` } } }],
    ["manager digest identity", { ...evidence(), body: { ...evidence().body, managerImage: { ...evidence().body.managerImage, platformDigest: DIGEST.MANAGER_INDEX } } }],
    ["worker digest identity", { ...evidence(), body: { ...evidence().body, workerImage: { ...evidence().body.workerImage, configDigest: DIGEST.WORKER_PLATFORM } } }],
    ["distinct image refs", { ...evidence(), body: { ...evidence().body, workerImage: { ...evidence().body.workerImage, ref: MANAGER_IMAGE_REF, indexDigest: DIGEST.MANAGER_INDEX } } }],
    ["distinct receipt digests", { ...evidence(), body: { ...evidence().body, workerProductionAuditReceiptSha256: MANAGER_AUDIT_RECEIPT_SHA256 } }],
  ])("rejects broken %s", (_name, input) => {
    // Given: image evidence with a broken OCI identity invariant.
    // When/Then: the schema rejects it.
    expect(() => parseManagedReleaseEvidence(input)).toThrow()
  })

  it.each([
    ["three-part browser version", { ...evidence(), body: { ...evidence().body, browserVersion: "140.0.7339" } }],
    ["zero epoch", { ...evidence(), body: { ...evidence().body, source: { ...SOURCE, sourceDateEpoch: "0" } } }],
    ["padded epoch", { ...evidence(), body: { ...evidence().body, source: { ...SOURCE, sourceDateEpoch: "01784567890" } } }],
    ["wide epoch", { ...evidence(), body: { ...evidence().body, source: { ...SOURCE, sourceDateEpoch: "1".repeat(21) } } }],
    ["non-commit revision", { ...evidence(), body: { ...evidence().body, source: { ...SOURCE, managedRevision: "a".repeat(39) } } }],
    ["timestamp without milliseconds", { ...evidence(), body: { ...evidence().body, generatedAt: "2026-07-21T10:11:12Z" } }],
    ["timestamp with offset", { ...evidence(), body: { ...evidence().body, generatedAt: "2026-07-21T19:11:12.345+09:00" } }],
    ["timestamp after source epoch", { ...evidence(), body: { ...evidence().body, generatedAt: "2026-07-20T17:18:10.001Z" } }],
  ])("rejects noncanonical %s", (_name, input) => {
    // Given: a noncanonical primitive at the publication boundary.
    // When/Then: the schema rejects it.
    expect(() => parseManagedReleaseEvidence(input)).toThrow()
  })
})

describe("managed release evidence raw verifier", () => {
  it("accepts canonical UTF-8 bytes terminated by exactly one LF", () => {
    // Given: canonical release bytes and their external whole-file digest.
    const rawBytes = Buffer.from(canonicalBytes(), "utf8")

    // When: the Node-only verifier checks the publication.
    const verified = verifyManagedReleaseEvidenceBytes(rawBytes, expected(rawBytes))

    // Then: the bound immutable evidence is returned.
    expect(verified.body.workerImage.ref).toBe(WORKER_IMAGE_REF)
    expect(Object.isFrozen(verified)).toBe(true)
  })

  it("hashes exact LF-terminated bytes before JSON parsing", () => {
    // Given: invalid JSON and a deliberately different trusted digest.
    const rawBytes = "{not-json}\n"
    const mismatchedExpected = { ...expected(rawBytes), releaseEvidenceSha256: "0".repeat(64) }

    // When: verification starts at the byte boundary.
    const verify = () => verifyManagedReleaseEvidenceBytes(rawBytes, mismatchedExpected)

    // Then: whole-file digest mismatch wins over JSON syntax handling.
    expect(verify).toThrowError(new ManagedReleaseEvidenceMismatchError(
      MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD.RELEASE_EVIDENCE_SHA256,
    ))
  })

  it("reports matching-hash invalid JSON as noncanonical bytes", () => {
    // Given: syntactically invalid JSON with a trusted hash over those exact bytes.
    const rawBytes = "not-json\n"

    // When/Then: syntax failure is normalized at the canonical-byte boundary.
    expect(() => verifyManagedReleaseEvidenceBytes(rawBytes, expected(rawBytes))).toThrowError(
      new ManagedReleaseEvidenceMismatchError(MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD.CANONICAL_BYTES),
    )
  })

  it.each([
    ["missing LF", canonicalBytes().slice(0, -1)],
    ["extra LF", `${canonicalBytes()}\n`],
    ["noncanonical key order", `${JSON.stringify(evidence())}\n`],
    ["CRLF", `${canonicalBytes().slice(0, -1)}\r\n`],
    ["UTF-8 BOM", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(canonicalBytes())])],
  ] satisfies readonly (readonly [string, string | Uint8Array])[])("rejects %s with a matching external digest", (_name, rawBytes) => {
    // Given: valid JSON bytes that differ from canonical JSON plus one LF.
    // When: verification reaches byte canonicality.
    const verify = () => verifyManagedReleaseEvidenceBytes(rawBytes, expected(rawBytes))

    // Then: the byte surface is rejected explicitly.
    expect(verify).toThrowError(new ManagedReleaseEvidenceMismatchError(
      MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD.CANONICAL_BYTES,
    ))
  })

  it("rejects malformed UTF-8 with a matching external digest", () => {
    // Given: a byte sequence that is not valid UTF-8.
    const rawBytes = Uint8Array.from([0xff, 0x0a])

    // When/Then: encoding canonicality fails before JSON parsing.
    expect(() => verifyManagedReleaseEvidenceBytes(rawBytes, expected(rawBytes))).toThrowError(
      new ManagedReleaseEvidenceMismatchError(MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD.CANONICAL_BYTES),
    )
  })

  it.each([
    [MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD.MANAGER_IMAGE_REF, { managerImageRef: `registry.example/other@${DIGEST.MANAGER_INDEX}` }],
    [MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD.WORKER_IMAGE_REF, { workerImageRef: `registry.example/other@${DIGEST.WORKER_INDEX}` }],
    [MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD.BROWSER_VERSION, { browserVersion: "141.0.0.1" }],
    [MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD.SOURCE, { source: { ...SOURCE, upstreamRevision: "c".repeat(40) } }],
    [MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD.TOOLCHAIN_LOCK_SHA256, { toolchainLockSha256: "a".repeat(64) }],
    [MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD.MANAGER_PRODUCTION_AUDIT_RECEIPT_SHA256, { managerProductionAuditReceiptSha256: "c".repeat(64) }],
    [MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD.WORKER_PRODUCTION_AUDIT_RECEIPT_SHA256, { workerProductionAuditReceiptSha256: "d".repeat(64) }],
    [MANAGED_RELEASE_EVIDENCE_MISMATCH_FIELD.WORKER_RUNTIME_STRATEGY_RECEIPT_SHA256, { workerRuntimeStrategyReceiptSha256: "e".repeat(64) }],
  ])("binds external %s", (field, mutation) => {
    // Given: canonical evidence and a different trusted external expectation.
    const rawBytes = canonicalBytes()

    // When/Then: the exact binding mismatch is reported.
    expect(() => verifyManagedReleaseEvidenceBytes(rawBytes, { ...expected(rawBytes), ...mutation })).toThrowError(
      new ManagedReleaseEvidenceMismatchError(field),
    )
  })
})
