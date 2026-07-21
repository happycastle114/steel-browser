import {
  ADMISSION_STATE,
  AdmissionIdSchema,
  AdmissionSchema,
  CONTROL_PLANE_API_VERSION,
  CreateIdempotencyKeySchema,
  MANAGED_ADMISSION_OPERATION,
  MANAGED_RELEASE_EVIDENCE_MODE,
  PrincipalIdSchema,
  VersionSchema,
} from "@happycastle/steel-managed-shared"
import { describe, expect, it } from "vitest"
import { ManagerOperationsPort } from "../src/operations/manager-operations-port.js"

describe("manager operations port", () => {
  it("checks serving mode before accepting a managed create", async () => {
    const calls: string[] = []
    let serving = false
    const admission = AdmissionSchema.parse({
      admissionId: AdmissionIdSchema.parse(
        "00000000-0000-4000-8000-000000000301",
      ),
      createdAt: new Date(0).toISOString(),
      expiresAt: new Date(10_000).toISOString(),
      state: ADMISSION_STATE.QUEUED,
      updatedAt: new Date(0).toISOString(),
    })
    const port = new ManagerOperationsPort({
      admissions: {
        cancelAdmission: async () => admission,
        captureQueue: async () => [admission],
        captureSessions: async () => [],
        createAdmission: async () => {
          calls.push("create")
          return admission
        },
        findAdmission: async () => undefined,
        findSession: async () => undefined,
        releaseSession: async () => {
          throw new TypeError("release not expected")
        },
        shutdown: () => undefined,
      },
      pool: {
        drainPool: async () => {
          throw new TypeError("drain not expected")
        },
        markMutation: () => calls.push("mutation"),
        readPool: async () => {
          throw new TypeError("pool read not expected")
        },
        requireServing: () => {
          if (!serving) throw new TypeError("not serving")
        },
        resumePool: async () => {
          throw new TypeError("resume not expected")
        },
      },
      version: VersionSchema.parse({
        apiVersion: CONTROL_PLANE_API_VERSION,
        browserVersion: "150.0.0.0",
        createTokenKeyId: "1".repeat(16),
        managedSha: "2".repeat(40),
        managerConfigSha256: "3".repeat(64),
        managerDigest: `sha256:${"4".repeat(64)}`,
        releaseEvidenceMode: MANAGED_RELEASE_EVIDENCE_MODE.CONFIG_FILE,
        releaseEvidenceSha256: "5".repeat(64),
        startedAt: new Date(0).toISOString(),
        toolchainLockSha256: "6".repeat(64),
        upstreamSha: "7".repeat(40),
        workerDigest: `sha256:${"8".repeat(64)}`,
      }),
      workers: () => [],
    })
    const command = {
      principalId: PrincipalIdSchema.parse("USER:operations-owner"),
      request: {
        idempotencyKey: CreateIdempotencyKeySchema.parse("operations-create-0001"),
        operation: MANAGED_ADMISSION_OPERATION.SESSION_CREATE,
      },
    }

    await expect(port.createAdmission(command)).rejects.toThrow("not serving")
    serving = true
    await expect(port.createAdmission(command)).resolves.toEqual(admission)
    expect(calls).toEqual(["mutation", "create"])
  })
})
