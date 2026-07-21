import {
  ManagedListSnapshotStore,
} from "@happycastle/steel-managed-gateway"
import {
  ADMISSION_STATE,
  AdmissionIdSchema,
  AdmissionSchema,
  BootIdSchema,
  CONTROL_PLANE_API_VERSION,
  CreateIdempotencyKeySchema,
  PRINCIPAL_ROLE,
  PrincipalIdSchema,
  ResultIdSchema,
  TOOL_NAME,
  TOOL_VERSION,
  UuidSchema,
  selectPublicOrigin,
} from "@happycastle/steel-managed-shared"
import { describe, expect, it } from "vitest"
import { ManagerAiExecutionPort } from "../src/ai/manager-ai-execution-port.js"

const PRINCIPAL_ID = PrincipalIdSchema.parse("USER:ai-owner")

describe("manager AI execution port", () => {
  it("executes the canonical session-create tool through the operations port", async () => {
    const admission = AdmissionSchema.parse({
      admissionId: AdmissionIdSchema.parse(
        "00000000-0000-4000-8000-000000000301",
      ),
      createdAt: new Date(0).toISOString(),
      expiresAt: new Date(10_000).toISOString(),
      state: ADMISSION_STATE.QUEUED,
      updatedAt: new Date(0).toISOString(),
    })
    const port = new ManagerAiExecutionPort({
      browser: {
        execute: async () => {
          throw new TypeError("browser action not expected")
        },
      },
      clock: { now: () => 1_000 },
      operations: {
        cancelAdmission: async () => admission,
        captureSessions: async () => [],
        createAdmission: async () => admission,
        findAdmission: async () => undefined,
        findSession: async () => undefined,
        releaseSession: async () => {
          throw new TypeError("release not expected")
        },
      },
      sessionSnapshots: new ManagedListSnapshotStore({
        bootId: BootIdSchema.parse(
          "00000000-0000-4000-8000-000000000401",
        ),
        clock: { now: () => 1_000 },
        maxBytes: 1_048_576,
        maxSnapshots: 10,
        ttlMs: 30_000,
      }),
    })
    const action = {
      apiVersion: CONTROL_PLANE_API_VERSION,
      arguments: {
        idempotencyKey: CreateIdempotencyKeySchema.parse("ai-create-0001"),
      },
      tool: { name: TOOL_NAME.SESSION_CREATE, version: TOOL_VERSION },
    } as const
    const completion = await port.execute({
      action,
      context: {
        correlationId: UuidSchema.parse("00000000-0000-4000-8000-000000000501"),
        requestId: UuidSchema.parse("00000000-0000-4000-8000-000000000502"),
      },
      principal: { principalId: PRINCIPAL_ID, role: PRINCIPAL_ROLE.USER },
      resultId: ResultIdSchema.parse(
        "00000000-0000-4000-8000-000000000601",
      ),
      selectedOrigin: selectPublicOrigin("steel.soungmin.tech", {
        "steel.soungmin.tech": "https://steel.soungmin.tech",
      }),
      signal: new AbortController().signal,
    })

    expect(completion).toMatchObject({
      action,
      completedAtMs: 1_000,
      output: { admission },
      ownerId: PRINCIPAL_ID,
    })
  })
})
