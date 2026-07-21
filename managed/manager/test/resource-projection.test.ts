import {
  AdmissionTicketIdSchema,
  AdmissionState as GatewayAdmissionState,
  AllocationIdSchema,
  InstanceIdSchema,
  PublicSessionIdSchema,
  SessionState as GatewaySessionState,
  UpstreamSessionIdSchema,
  WorkerIdSchema,
  WorkerOriginSchema,
  WorkerState as GatewayWorkerState,
} from "@happycastle/steel-managed-gateway"
import {
  ADMISSION_STATE,
  SESSION_STATE,
  WORKER_STATE,
} from "@happycastle/steel-managed-shared"
import { describe, expect, it } from "vitest"
import {
  projectAdmissionTicket,
  projectSessionRecord,
  projectWorkerRecord,
} from "../src/operations/resource-projection.js"

const SESSION_ID = PublicSessionIdSchema.parse(
  "00000000-0000-4000-8000-000000000101",
)
const INSTANCE_ID = InstanceIdSchema.parse(
  "00000000-0000-4000-8000-000000000201",
)
const ALLOCATION_ID = AllocationIdSchema.parse("allocation-projection")

describe("managed operations resource projection", () => {
  it("maps uncertain unreachable workers without leaking gateway-only state", () => {
    const projected = projectWorkerRecord({
      allocationId: ALLOCATION_ID,
      instanceId: INSTANCE_ID,
      observedAt: 1_000,
      origin: WorkerOriginSchema.parse("http://worker-00:3000"),
      sessionId: SESSION_ID,
      state: GatewayWorkerState.RELEASE_UNCERTAIN_UNREACHABLE,
      workerId: WorkerIdSchema.parse("worker-00"),
    })

    expect(projected).toMatchObject({
      state: WORKER_STATE.UNREACHABLE,
      sessionId: SESSION_ID,
    })
  })

  it("preserves terminal session timestamps", () => {
    const projected = projectSessionRecord({
      allocationId: ALLOCATION_ID,
      createdAt: 1_000,
      instanceId: INSTANCE_ID,
      publicSessionId: SESSION_ID,
      state: GatewaySessionState.RELEASED,
      terminalAt: 2_000,
      upstreamSessionId: UpstreamSessionIdSchema.parse(SESSION_ID),
      workerId: WorkerIdSchema.parse("worker-00"),
    })

    expect(projected).toMatchObject({
      endedAt: new Date(2_000).toISOString(),
      state: SESSION_STATE.RELEASED,
    })
  })

  it("maps completed admission tickets to admitted resources", () => {
    const projected = projectAdmissionTicket(
      "00000000-0000-4000-8000-000000000301",
      {
      allocationId: ALLOCATION_ID,
      createdAt: 1_000,
      expiresAt: 5_000,
      id: AdmissionTicketIdSchema.parse("ticket-projection"),
      payload: { publicSessionId: SESSION_ID },
      state: GatewayAdmissionState.COMPLETED,
      terminalAt: 2_000,
      },
    )

    expect(projected).toMatchObject({
      admissionId: "00000000-0000-4000-8000-000000000301",
      sessionId: SESSION_ID,
      state: ADMISSION_STATE.ADMITTED,
      updatedAt: new Date(2_000).toISOString(),
    })
  })
})
