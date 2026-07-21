import {
  AdmissionState as GatewayAdmissionState,
  AdmissionTicketIdSchema,
  LifecycleCreateKind,
  PublicSessionIdSchema,
  type AdmissionSettlement,
  type AdmissionTicket,
  type PendingSessionCreate,
} from "@happycastle/steel-managed-gateway"
import {
  ADMISSION_STATE,
  AdmissionIdSchema,
  CreateIdempotencyKeySchema,
  MANAGED_ADMISSION_OPERATION,
  MANAGED_CREATE_HEADER,
  ManagedCreateHeaderValuesSchema,
  PrincipalIdSchema,
} from "@happycastle/steel-managed-shared"
import { describe, expect, it } from "vitest"
import { ManagedAdmissionCoordinator } from "../src/operations/admission-coordinator.js"

const PRINCIPAL_ID = PrincipalIdSchema.parse("USER:admission-owner")
const SESSION_ID = PublicSessionIdSchema.parse(
  "00000000-0000-4000-8000-000000000101",
)
const TICKET_ID = AdmissionTicketIdSchema.parse("ticket-admission-coordinator")
const ADMISSION_ID = AdmissionIdSchema.parse(
  "00000000-0000-4000-8000-000000000301",
)
const CREATE_HEADERS = ManagedCreateHeaderValuesSchema.parse({
  [MANAGED_CREATE_HEADER.MANAGER_INSTANCE_ID]: "00000000-0000-4000-8000-000000000401",
  [MANAGED_CREATE_HEADER.OWNER_SHA256]: "a".repeat(64),
  [MANAGED_CREATE_HEADER.POOL_ID]: "test-pool",
  [MANAGED_CREATE_HEADER.REQUEST_SHA256]: "b".repeat(64),
  [MANAGED_CREATE_HEADER.TOKEN]: `h1_${"c".repeat(64)}`,
})

describe("managed admission coordinator", () => {
  it("replays an idempotent queued create and preserves same-owner lookup", async () => {
    let creates = 0
    let ticket: AdmissionTicket<PendingSessionCreate> = queuedTicket()
    const coordinator = new ManagedAdmissionCoordinator({
      admissions: {
        cancel: () => {
          ticket = {
            ...ticket,
            state: GatewayAdmissionState.CANCELLED,
            terminalAt: 2_000,
          }
          return { ticket }
        },
        get: () => ticket,
        shutdown: () => [],
      },
      clock: { now: () => 1_000 },
      createHeaders: async () => CREATE_HEADERS,
      ids: { nextAdmissionId: () => ADMISSION_ID },
      lifecycle: {
        create: async () => {
          creates += 1
          return {
            admissionTicketId: TICKET_ID,
            kind: LifecycleCreateKind.QUEUED,
            publicSessionId: SESSION_ID,
          }
        },
        release: async () => {
          throw new TypeError("release not expected")
        },
      },
      registry: { session: () => undefined },
      ticketTtlMilliseconds: 10_000,
    })
    const command = {
      principalId: PRINCIPAL_ID,
      request: {
        idempotencyKey: CreateIdempotencyKeySchema.parse("admission-key-0001"),
        operation: MANAGED_ADMISSION_OPERATION.SESSION_CREATE,
      },
    } as const

    const first = await coordinator.createAdmission(command)
    const replay = await coordinator.createAdmission(command)
    const found = await coordinator.findAdmission(ADMISSION_ID)

    expect(creates).toBe(1)
    expect(first).toEqual(replay)
    expect(found).toEqual({ ownerId: PRINCIPAL_ID, resource: first })
    expect(first.state).toBe(ADMISSION_STATE.QUEUED)
  })

  it("cancels the tracked gateway ticket and keeps the managed admission identity", async () => {
    let ticket: AdmissionTicket<PendingSessionCreate> = queuedTicket()
    const coordinator = new ManagedAdmissionCoordinator({
      admissions: {
        cancel: (): AdmissionSettlement<PendingSessionCreate> => {
          ticket = {
            ...ticket,
            state: GatewayAdmissionState.CANCELLED,
            terminalAt: 2_000,
          }
          return { ticket }
        },
        get: () => ticket,
        shutdown: () => [],
      },
      clock: { now: () => 1_000 },
      createHeaders: async () => CREATE_HEADERS,
      ids: { nextAdmissionId: () => ADMISSION_ID },
      lifecycle: {
        create: async () => ({
          admissionTicketId: TICKET_ID,
          kind: LifecycleCreateKind.QUEUED,
          publicSessionId: SESSION_ID,
        }),
        release: async () => {
          throw new TypeError("release not expected")
        },
      },
      registry: { session: () => undefined },
      ticketTtlMilliseconds: 10_000,
    })
    await coordinator.createAdmission({
      principalId: PRINCIPAL_ID,
      request: {
        idempotencyKey: CreateIdempotencyKeySchema.parse("admission-key-0002"),
        operation: MANAGED_ADMISSION_OPERATION.SESSION_CREATE,
      },
    })

    const cancelled = await coordinator.cancelAdmission({
      admissionId: ADMISSION_ID,
      body: {},
      principalId: PRINCIPAL_ID,
    })

    expect(cancelled).toMatchObject({
      admissionId: ADMISSION_ID,
      state: ADMISSION_STATE.CANCELLED,
    })
  })
})

function queuedTicket(): AdmissionTicket<PendingSessionCreate> {
  return {
    createdAt: 1_000,
    expiresAt: 11_000,
    id: TICKET_ID,
    payload: { publicSessionId: SESSION_ID },
    state: GatewayAdmissionState.QUEUED,
  }
}
