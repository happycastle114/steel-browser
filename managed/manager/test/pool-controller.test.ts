import {
  InstanceIdSchema,
  WorkerIdSchema,
  WorkerOriginSchema,
  WorkerState as GatewayWorkerState,
  type WorkerRecord,
} from "@happycastle/steel-managed-gateway"
import {
  CreateIdempotencyKeySchema,
  IsoTimeSchema,
  MANAGER_MODE,
  MANAGER_MODE_CAUSE,
  ManagerInstanceIdSchema,
  PrincipalIdSchema,
} from "@happycastle/steel-managed-shared"
import { describe, expect, it } from "vitest"
import { parseManagerConfig } from "../src/config.js"
import { ManagerPoolController } from "../src/operations/pool-controller.js"
import { validManagerConfigInput, validPoolId } from "./fixtures.js"

const MANAGER_INSTANCE_ID = ManagerInstanceIdSchema.parse(
  "00000000-0000-4000-8000-000000000401",
)
const PRINCIPAL_ID = PrincipalIdSchema.parse("SERVICE_TOKEN:pool-operator")

describe("manager pool controller", () => {
  it("requires an exact safe handover before serving and emits a fresh drain proof", async () => {
    let now = 1_000
    const config = parseManagerConfig(validManagerConfigInput(), validPoolId())
    const controller = new ManagerPoolController({
      action: () => ({ active: 0, closed: false, limit: config.controlPlane.memory.actionMax }),
      clock: { now: () => now },
      config,
      ingressBody: () => emptyLedger(
        config.controlPlane.memory.ingressBodyBudgetBytes,
        config.controlPlane.memory.ingressBodyMax,
      ),
      ingressConnection: () => emptyLedger(
        config.controlPlane.memory.ingressConnectionBudgetBytes,
        config.controlPlane.memory.ingressConnectionMax,
      ),
      managerInstanceId: MANAGER_INSTANCE_ID,
      queueDepth: () => 0,
      result: () => ({
        inFlightBytes: 0,
        inFlightCount: 0,
        reservedBytes: 0,
        reservedCount: 0,
        retainedBytes: 0,
        retainedCount: 0,
      }),
      webSocket: () => ({
        activeCount: 0,
        limitBytes: config.controlPlane.memory.webSocketBudgetBytes,
        limitCount: config.controlPlane.memory.webSocketMax,
        reservationBytes: config.controlPlane.memory.webSocketReservationBytes,
        reservedBytes: 0,
      }),
      workers: () => [idleWorker(0, now), idleWorker(1, now)],
    })
    const boot = await controller.readPool()
    expect(boot.mode).toBe(MANAGER_MODE.DRAINING)
    expect(boot.handover.safe).toBe(false)
    if (boot.handover.mode !== MANAGER_MODE.DRAINING) {
      throw new TypeError("expected draining handover")
    }
    now = Date.parse(boot.handover.safeAt)

    const serving = await controller.resumePool({
      principalId: PRINCIPAL_ID,
      request: {
        expectedManagerInstanceId: MANAGER_INSTANCE_ID,
        expectedSafeAt: boot.handover.safeAt,
        idempotencyKey: CreateIdempotencyKeySchema.parse("pool-resume-0001"),
        reason: MANAGER_MODE_CAUSE.RECOVERY,
      },
    })
    expect(serving.mode).toBe(MANAGER_MODE.SERVING)

    now += 1_000
    const draining = await controller.drainPool({
      principalId: PRINCIPAL_ID,
      request: {
        deadlineAt: IsoTimeSchema.parse(
          new Date(now + config.controlPlane.drainTimeoutMs).toISOString(),
        ),
        expectedManagerInstanceId: MANAGER_INSTANCE_ID,
        idempotencyKey: CreateIdempotencyKeySchema.parse("pool-drain-0001"),
        reason: MANAGER_MODE_CAUSE.CUTOVER,
      },
    })
    expect(draining.mode).toBe(MANAGER_MODE.DRAINING)
    expect(draining.handover).toMatchObject({
      cause: MANAGER_MODE_CAUSE.CUTOVER,
      safe: false,
    })
  })
})

function emptyLedger(limitBytes: number, limitCount: number) {
  return { limitBytes, limitCount, reservedBytes: 0, reservedCount: 0 }
}

function idleWorker(index: number, observedAt: number): WorkerRecord {
  return {
    instanceId: InstanceIdSchema.parse(
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    ),
    observedAt,
    origin: WorkerOriginSchema.parse(`http://worker-0${index}:3000`),
    state: GatewayWorkerState.IDLE,
    workerId: WorkerIdSchema.parse(`worker-0${index}`),
  }
}
