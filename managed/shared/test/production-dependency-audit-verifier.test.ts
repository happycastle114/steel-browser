import { createHash } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  PRODUCTION_DEPENDENCY_AUDIT_MISMATCH_FIELD,
  ProductionDependencyAuditMismatchError,
  verifyProductionDependencyAuditReceiptBytes,
} from "../src/index.js"
import {
  canonicalReceiptBytes,
  managerReceipt,
  NODE_IMAGE,
  NODE_VERSION,
  NPM_VERSION,
  receiptSha256,
  SOURCE_REVISION,
  SOURCE_TREE_SHA256,
  VERIFICATION_DATE,
  workerReceipt,
} from "./production-dependency-audit-fixture.js"

function expected(rawBytes: string) {
  return {
    receiptSha256: receiptSha256(rawBytes),
    target: "WORKER",
    source: { revision: SOURCE_REVISION, treeSha256: SOURCE_TREE_SHA256 },
    runtime: { nodeImage: NODE_IMAGE, nodeVersion: NODE_VERSION, npmVersion: NPM_VERSION },
    verificationDate: VERIFICATION_DATE,
  }
}

describe("production dependency audit raw verifier", () => {
  it("accepts canonical UTF-8 bytes terminated by exactly one LF", () => {
    // Given: a canonical V1 receipt and an external hash over its LF-terminated bytes.
    const rawBytes = canonicalReceiptBytes(workerReceipt())

    // When: the raw publication boundary verifies it.
    const receipt = verifyProductionDependencyAuditReceiptBytes(rawBytes, expected(rawBytes))

    // Then: the verified immutable receipt is returned.
    expect(receipt.target).toBe("WORKER")
    expect(Object.isFrozen(receipt)).toBe(true)
  })

  it("verifies the canonical manager target through the Node root export", () => {
    // Given: a canonical manager receipt with the exact manager workspace policy.
    const rawBytes = canonicalReceiptBytes(managerReceipt())
    const managerExpected = { ...expected(rawBytes), target: "MANAGER" }

    // When: the root-exported verifier validates the raw receipt.
    const receipt = verifyProductionDependencyAuditReceiptBytes(rawBytes, managerExpected)

    // Then: the manager target is returned without worker overlays.
    expect(receipt.target).toBe("MANAGER")
    expect(receipt.install.nativeOverlays).toEqual([])
  })

  it("checks the external receipt hash before JSON parsing", () => {
    // Given: invalid JSON whose trusted external hash intentionally differs.
    const rawBytes = "{not-json}\n"
    const invalidExpected = { ...expected(canonicalReceiptBytes(workerReceipt())), receiptSha256: "0".repeat(64) }

    // When: verification starts at the raw-byte boundary.
    const verify = () => verifyProductionDependencyAuditReceiptBytes(rawBytes, invalidExpected)

    // Then: receipt hash mismatch wins over JSON syntax handling.
    expect(verify).toThrowError(new ProductionDependencyAuditMismatchError(
      PRODUCTION_DEPENDENCY_AUDIT_MISMATCH_FIELD.RECEIPT_SHA256,
    ))
  })

  it("reports matching-hash invalid JSON as noncanonical bytes", () => {
    // Given: syntactically invalid JSON with a trusted hash over those exact bytes.
    const rawBytes = "not-json\n"

    // When/Then: syntax failure is normalized at the canonical-byte boundary.
    expect(() => verifyProductionDependencyAuditReceiptBytes(rawBytes, expected(rawBytes))).toThrowError(
      new ProductionDependencyAuditMismatchError(PRODUCTION_DEPENDENCY_AUDIT_MISMATCH_FIELD.CANONICAL_BYTES),
    )
  })

  it.each([
    ["missing LF", (canonical: string) => canonical.slice(0, -1)],
    ["extra LF", (canonical: string) => `${canonical}\n`],
    ["noncanonical key order", () => `${JSON.stringify(workerReceipt())}\n`],
  ])("rejects %s even when its external hash matches", (_name, mutate) => {
    // Given: byte-valid JSON that is not the exact canonical one-LF serialization.
    const rawBytes = mutate(canonicalReceiptBytes(workerReceipt()))

    // When: verification reaches canonical-byte comparison.
    const verify = () => verifyProductionDependencyAuditReceiptBytes(rawBytes, expected(rawBytes))

    // Then: canonical byte mismatch is explicit.
    expect(verify).toThrowError(new ProductionDependencyAuditMismatchError(
      PRODUCTION_DEPENDENCY_AUDIT_MISMATCH_FIELD.CANONICAL_BYTES,
    ))
  })

  it.each([
    ["target", { target: "MANAGER" }, PRODUCTION_DEPENDENCY_AUDIT_MISMATCH_FIELD.TARGET],
    ["source revision", { source: { revision: "2".repeat(40), treeSha256: SOURCE_TREE_SHA256 } }, PRODUCTION_DEPENDENCY_AUDIT_MISMATCH_FIELD.SOURCE],
    ["source tree", { source: { revision: SOURCE_REVISION, treeSha256: "2".repeat(64) } }, PRODUCTION_DEPENDENCY_AUDIT_MISMATCH_FIELD.SOURCE],
    ["npm version", { runtime: { nodeImage: NODE_IMAGE, nodeVersion: NODE_VERSION, npmVersion: "10.9.5" } }, PRODUCTION_DEPENDENCY_AUDIT_MISMATCH_FIELD.RUNTIME],
  ])("binds expected %s", (_name, mutation, mismatchField) => {
    // Given: a canonical receipt and a different trusted expected value.
    const rawBytes = canonicalReceiptBytes(workerReceipt())
    const mismatchedExpected = { ...expected(rawBytes), ...mutation }

    // When/Then: verification rejects the unbound receipt.
    expect(() => verifyProductionDependencyAuditReceiptBytes(rawBytes, mismatchedExpected)).toThrowError(
      new ProductionDependencyAuditMismatchError(mismatchField),
    )
  })

  it("requires the frozen V1 Node version in expected runtime", () => {
    // Given: canonical receipt bytes and an expected runtime with another Node patch.
    const rawBytes = canonicalReceiptBytes(workerReceipt())
    const mismatchedExpected = {
      ...expected(rawBytes),
      runtime: { nodeImage: NODE_IMAGE, nodeVersion: "22.23.2", npmVersion: NPM_VERSION },
    }

    // When/Then: expected-input parsing rejects a runtime outside V1.
    expect(() => verifyProductionDependencyAuditReceiptBytes(rawBytes, mismatchedExpected)).toThrow()
  })

  it("requires the exact production Node image in expected runtime", () => {
    // Given: canonical receipt bytes and another digest for the otherwise matching Node tag.
    const rawBytes = canonicalReceiptBytes(workerReceipt())
    const mismatchedExpected = {
      ...expected(rawBytes),
      runtime: {
        nodeImage: `docker.io/library/node:22.23.1-bookworm@sha256:${"1".repeat(64)}`,
        nodeVersion: NODE_VERSION,
        npmVersion: NPM_VERSION,
      },
    }

    // When/Then: expected-input parsing rejects a non-production base identity.
    expect(() => verifyProductionDependencyAuditReceiptBytes(rawBytes, mismatchedExpected)).toThrow()
  })

  it.each([
    ["equal", "2026-08-31"],
    ["past", "2026-09-01"],
  ])("rejects a residual expiry that is %s to the verification date", (_name, verificationDate) => {
    // Given: a receipt whose exception is not strictly future at verification time.
    const rawBytes = canonicalReceiptBytes(workerReceipt())
    const dateExpected = { ...expected(rawBytes), verificationDate }

    // When/Then: verification rejects the expired exception.
    expect(() => verifyProductionDependencyAuditReceiptBytes(rawBytes, dateExpected)).toThrowError(
      new ProductionDependencyAuditMismatchError(PRODUCTION_DEPENDENCY_AUDIT_MISMATCH_FIELD.RESIDUAL_EXPIRY),
    )
  })

  it.each(["2026-02-30", "2026-7-21", "not-a-date"])("rejects invalid expected date %s", (verificationDate) => {
    // Given: a valid canonical receipt and an invalid expected verification date.
    const rawBytes = canonicalReceiptBytes(workerReceipt())

    // When/Then: the expected-input boundary rejects the date.
    expect(() => verifyProductionDependencyAuditReceiptBytes(rawBytes, {
      ...expected(rawBytes),
      verificationDate,
    })).toThrow()
  })

  it("accepts Uint8Array input without re-encoding the hash surface", () => {
    // Given: canonical UTF-8 bytes supplied as a binary array.
    const rawText = canonicalReceiptBytes(workerReceipt())
    const rawBytes = Buffer.from(rawText, "utf8")
    const binaryExpected = {
      ...expected(rawText),
      receiptSha256: createHash("sha256").update(rawBytes).digest("hex"),
    }

    // When: the verifier hashes the original binary bytes.
    const receipt = verifyProductionDependencyAuditReceiptBytes(rawBytes, binaryExpected)

    // Then: binary input produces the same verified target.
    expect(receipt.target).toBe("WORKER")
  })

  it("rejects malformed UTF-8 as noncanonical bytes", () => {
    // Given: invalid UTF-8 whose trusted external digest matches those exact bytes.
    const rawBytes = Uint8Array.from([0xff, 0x0a])
    const malformedExpected = {
      ...expected(canonicalReceiptBytes(workerReceipt())),
      receiptSha256: createHash("sha256").update(rawBytes).digest("hex"),
    }

    // When/Then: canonical encoding fails before JSON parsing.
    expect(() => verifyProductionDependencyAuditReceiptBytes(rawBytes, malformedExpected)).toThrowError(
      new ProductionDependencyAuditMismatchError(PRODUCTION_DEPENDENCY_AUDIT_MISMATCH_FIELD.CANONICAL_BYTES),
    )
  })
})
