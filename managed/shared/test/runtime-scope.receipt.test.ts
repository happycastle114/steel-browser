import { describe, expect, it } from "vitest"

import * as managed from "../src/managed-overlay.js"

const HASH = {
  CONFIG_BLUE: "a".repeat(64),
  CONFIG_GREEN: "b".repeat(64),
  FINGERPRINT: "c".repeat(64),
  KEY_ID: "d".repeat(64),
  RECEIPT_KEY_ID: "e".repeat(64),
  SIGNATURE: "f".repeat(64),
  STATUS: "1".repeat(64),
  CONFIG_ENV: "2".repeat(64),
  PROCESS_ENV: "3".repeat(64),
  FD_INVENTORY: "4".repeat(64),
} as const

function configReceipt(slot: "MANAGED_BLUE" | "MANAGED_GREEN") {
  const blue = slot === managed.COOLIFY_PRODUCTION_OWNER.MANAGED_BLUE
  return {
    schemaVersion: 1,
    kind: "CONFIG_WRITE_RECEIPT",
    proofLevel: managed.FINGERPRINT_PROOF_LEVEL.CONFIG_BOUND,
    applicationId: blue
      ? "10000000-0000-4000-8000-000000000001"
      : "10000000-0000-4000-8000-000000000002",
    slot,
    poolId: blue ? "managed-blue" : "managed-green",
    createTokenKeyId: HASH.KEY_ID,
    configSha256: blue ? HASH.CONFIG_BLUE : HASH.CONFIG_GREEN,
    fingerprintHmacSha256: HASH.FINGERPRINT,
    overlayPlanSha256: managed.EXPECTED_OVERLAY_PLAN_SHA256,
    environment: {
      uuid: blue
        ? "20000000-0000-4000-8000-000000000001"
        : "20000000-0000-4000-8000-000000000002",
      key: "STEEL_MANAGED_CREATE_TOKEN_KEY_HEX",
      isPreview: false,
      isLiteral: true,
      isMultiline: false,
      isShownOnce: true,
      isRuntime: true,
      isBuildtime: false,
    },
    signature: {
      algorithm: "HMAC_SHA256",
      keyId: HASH.RECEIPT_KEY_ID,
      hmacSha256: HASH.SIGNATURE,
    },
  }
}

function startedManagerReceipt() {
  const config = configReceipt(managed.COOLIFY_PRODUCTION_OWNER.MANAGED_BLUE)
  return {
    schemaVersion: 1,
    kind: "STARTED_MANAGER_RECEIPT",
    applicationId: config.applicationId,
    managerInstanceId: "30000000-0000-4000-8000-000000000001",
    managerImageDigest: `sha256:${"5".repeat(64)}`,
    observedAt: "2026-07-20T14:00:00.000Z",
    createTokenKeyId: config.createTokenKeyId,
    configSha256: config.configSha256,
    fingerprintHmacSha256: config.fingerprintHmacSha256,
    managerStatusSha256: HASH.STATUS,
    configEnvSha256: HASH.CONFIG_ENV,
    processEnvironmentSha256: HASH.PROCESS_ENV,
    fdInventorySha256: HASH.FD_INVENTORY,
  }
}

function callerAuthoredRuntimeProofFixture() {
  const hash = (character: string) => character.repeat(64)
  const config = {
    schemaVersion: 1,
    kind: managed.FINGERPRINT_RECEIPT_KIND.CONFIG_WRITE,
    proofLevel: managed.FINGERPRINT_PROOF_LEVEL.CONFIG_BOUND,
    applicationId: "10000000-0000-4000-8000-000000000001",
    slot: managed.COOLIFY_PRODUCTION_OWNER.MANAGED_BLUE,
    poolId: managed.RUNTIME_SCOPE_POOL.BLUE,
    createTokenKeyId: hash("a"),
    configSha256: hash("b"),
    fingerprintHmacSha256: hash("c"),
    overlayPlanSha256: managed.EXPECTED_OVERLAY_PLAN_SHA256,
    environment: {
      uuid: "20000000-0000-4000-8000-000000000001",
      key: managed.MANAGED_SECRET_ENVIRONMENT_KEY,
      isPreview: false,
      isLiteral: true,
      isMultiline: false,
      isShownOnce: true,
      isRuntime: true,
      isBuildtime: false,
    },
    signature: {
      algorithm: managed.RECEIPT_SIGNATURE_ALGORITHM.HMAC_SHA256,
      keyId: hash("d"),
      hmacSha256: hash("e"),
    },
  }
  const started = {
    schemaVersion: 1,
    kind: managed.FINGERPRINT_RECEIPT_KIND.STARTED_MANAGER,
    applicationId: config.applicationId,
    managerInstanceId: "30000000-0000-4000-8000-000000000001",
    managerImageDigest: `sha256:${hash("f")}`,
    observedAt: "2026-07-20T14:00:00.000Z",
    createTokenKeyId: config.createTokenKeyId,
    configSha256: config.configSha256,
    fingerprintHmacSha256: config.fingerprintHmacSha256,
    managerStatusSha256: hash("1"),
    configEnvSha256: hash("2"),
    processEnvironmentSha256: hash("3"),
    fdInventorySha256: hash("4"),
  }
  return {
    proofLevel: managed.FINGERPRINT_PROOF_LEVEL.RUNTIME_VERIFIED,
    projectRuntimeState: managed.MANAGED_PROJECT_RUNTIME_STATE.ACTIVE,
    configReceipt: config,
    startedManagerReceipt: started,
  }
}

describe("runtime-scope fingerprint receipt contract", () => {
  it("accepts two no-echo writes with one synthetic fingerprint", () => {
    // Given: signed per-application receipts with distinct config identities and one key fingerprint.
    const input = {
      blueReceiptInput: configReceipt(managed.COOLIFY_PRODUCTION_OWNER.MANAGED_BLUE),
      greenReceiptInput: configReceipt(managed.COOLIFY_PRODUCTION_OWNER.MANAGED_GREEN),
    }

    // When: the pair crosses the config-binding verifier.
    const result = managed.verifyFingerprintReceiptPair(input)

    // Then: only non-secret binding metadata is returned at CONFIG_BOUND.
    expect(result).toEqual({
      proofLevel: managed.FINGERPRINT_PROOF_LEVEL.CONFIG_BOUND,
      createTokenKeyId: HASH.KEY_ID,
      fingerprintHmacSha256: HASH.FINGERPRINT,
      applicationIds: [
        "10000000-0000-4000-8000-000000000001",
        "10000000-0000-4000-8000-000000000002",
      ],
      poolIds: ["managed-blue", "managed-green"],
    })
  })

  it.each([
    ["value", { value: "synthetic-secret" }],
    ["real_value", { real_value: "synthetic-secret" }],
    ["authorization", { authorization: "synthetic-secret" }],
  ])("rejects sensitive receipt field %s", (_field, sensitiveField) => {
    // Given: a config receipt with one echoed sensitive field.
    const input = {
      ...configReceipt(managed.COOLIFY_PRODUCTION_OWNER.MANAGED_BLUE),
      ...sensitiveField,
    }

    // When: the receipt crosses the no-echo schema.
    const result = managed.NoEchoWriteReceiptSchema.safeParse(input)

    // Then: strict parsing rejects the echoed value.
    expect(result.success).toBe(false)
  })

  it("rejects a runtime proof without a started-manager receipt", () => {
    // Given: an active runtime claim carrying only config-bound evidence.
    const input = {
      proofLevel: managed.FINGERPRINT_PROOF_LEVEL.RUNTIME_VERIFIED,
      projectRuntimeState: managed.MANAGED_PROJECT_RUNTIME_STATE.ACTIVE,
      configReceipt: configReceipt(managed.COOLIFY_PRODUCTION_OWNER.MANAGED_BLUE),
    }

    // When: the incomplete runtime claim crosses the proof schema.
    const result = managed.FingerprintProofSchema.safeParse(input)

    // Then: runtime verification fails closed.
    expect(result.success).toBe(false)
  })

  it("rejects runtime proof for a stopped project", () => {
    // Given: a complete manager receipt attached to a cold-standby state.
    const input = {
      proofLevel: managed.FINGERPRINT_PROOF_LEVEL.RUNTIME_VERIFIED,
      projectRuntimeState: managed.MANAGED_PROJECT_RUNTIME_STATE.COLD_STANDBY,
      configReceipt: configReceipt(managed.COOLIFY_PRODUCTION_OWNER.MANAGED_BLUE),
      startedManagerReceipt: startedManagerReceipt(),
    }

    // When: the stopped runtime claim crosses the proof schema.
    const result = managed.FingerprintProofSchema.safeParse(input)

    // Then: stopped configuration cannot advance beyond CONFIG_BOUND.
    expect(result.success).toBe(false)
  })

  it("rejects caller-authored runtime proof even when receipts correlate", () => {
    // Given: active state with caller-authored config and manager receipts bound to one application.
    const input = {
      proofLevel: managed.FINGERPRINT_PROOF_LEVEL.RUNTIME_VERIFIED,
      projectRuntimeState: managed.MANAGED_PROJECT_RUNTIME_STATE.ACTIVE,
      configReceipt: configReceipt(managed.COOLIFY_PRODUCTION_OWNER.MANAGED_BLUE),
      startedManagerReceipt: startedManagerReceipt(),
    }

    // When: the correlated claim crosses the proof schema.
    const result = managed.FingerprintProofSchema.safeParse(input)

    // Then: shape-valid caller data cannot manufacture privileged runtime proof.
    expect(result.success).toBe(false)
  })

  it("rejects the exact caller-authored runtime-proof fixture on every platform", () => {
    // Given: the portable boundary receives the reported shape-valid fake runtime proof.
    const input = callerAuthoredRuntimeProofFixture()

    // When: untrusted JSON crosses the public fingerprint-proof schema.
    const result = managed.FingerprintProofSchema.safeParse(input)

    // Then: no platform can upgrade caller-authored claims to RUNTIME_VERIFIED.
    expect(result.success).toBe(false)
  })

  it("derives equal non-secret fingerprints from equal synthetic keys", () => {
    // Given: two separately held copies of the same 32-byte synthetic key.
    const firstKey = Buffer.alloc(32, 0x2a)
    const secondKey = Buffer.alloc(32, 0x2a)
    const rawKeyHex = firstKey.toString("hex")

    // When: each project computes the canonical key identity and HMAC fingerprint.
    const first = managed.computeSecretFingerprint(firstKey)
    const second = managed.computeSecretFingerprint(secondKey)
    firstKey.fill(0)
    secondKey.fill(0)

    // Then: both results match and neither output echoes the key.
    expect(first).toEqual(second)
    expect(first.createTokenKeyId).toMatch(/^[0-9a-f]{64}$/u)
    expect(first.fingerprintHmacSha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(JSON.stringify(first)).not.toContain(rawKeyHex)
  })

  it("rejects a key that is not exactly 32 bytes", () => {
    // Given: a synthetic key with one missing byte.
    const shortKey = Buffer.alloc(31, 0x2a)

    // When: fingerprint computation is attempted.
    const compute = () => managed.computeSecretFingerprint(shortKey)

    // Then: the key boundary fails closed.
    expect(compute).toThrowError(managed.SecretFingerprintError)
    shortKey.fill(0)
  })
})
