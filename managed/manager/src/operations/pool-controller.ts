import {
  type ActionCapacitySnapshot,
  type WebSocketReservationSnapshot,
  type WorkerRecord,
} from "@happycastle/steel-managed-gateway"
import {
  CONTROL_PLANE_API_VERSION,
  CONTROL_PLANE_FIXED,
  HANDOVER_MODE,
  MANAGED_ERROR_CODE,
  MANAGER_MODE,
  MANAGER_MODE_CAUSE,
  computeDrainSafeAt,
  handoverIsSafe,
  poolSchemaForConfig,
  type ManagerInstanceId,
  type ManagerMode,
  type ManagerModeCause,
  type BlockingCounts,
  type Pool,
  type ResultReservationSnapshot,
} from "@happycastle/steel-managed-shared"
import {
  ManagedOperationsError,
  type ManagedPoolDrainCommand,
  type ManagedPoolResumeCommand,
} from "@happycastle/steel-managed-gateway"
import type { ManagerConfig } from "../config.js"
import type { ReservationLedgerSnapshot } from "../memory/atomic-reservation-ledger.js"
import {
  countUncertainWorkers,
  projectPoolMemory,
  projectPoolWorkerCounts,
} from "./pool-projection.js"

type ManagerPoolControllerOptions = Readonly<{
  action(): ActionCapacitySnapshot
  clock: Readonly<{ now(): number }>
  config: ManagerConfig
  ingressBody(): ReservationLedgerSnapshot
  ingressConnection(): ReservationLedgerSnapshot
  managerInstanceId: ManagerInstanceId
  queueDepth(): number
  result(): ResultReservationSnapshot
  webSocket(): WebSocketReservationSnapshot
  workers(): readonly WorkerRecord[]
}>

export class ManagerPoolController {
  #cause: ManagerModeCause = MANAGER_MODE_CAUSE.RECOVERY
  #drainEnteredAt: number
  #lastMutationAt: number
  #mode: ManagerMode

  public constructor(private readonly options: ManagerPoolControllerOptions) {
    const now = this.now()
    this.#mode = options.config.controlPlane.bootMode
    this.#drainEnteredAt = now
    this.#lastMutationAt = now
  }

  public async readPool(): Promise<Pool> {
    const now = this.now()
    const workers = this.options.workers()
    const byState = projectPoolWorkerCounts(workers)
    const usableReachable =
      byState.reachable + byState.idle + byState.reserved + byState.starting +
      byState.live + byState.releasing
    const busy = byState.reserved + byState.starting + byState.live + byState.releasing
    const unavailable =
      byState.discovered + byState.unreachable + byState.quarantined + byState.draining
    const blocking = {
      queued: this.options.queueDepth(),
      reserved: byState.reserved,
      starting: byState.starting,
      live: byState.live,
      releasing: byState.releasing,
      uncertain: countUncertainWorkers(workers),
      httpCreates: 0,
      webSockets: this.options.webSocket().activeCount,
    }
    const handover = this.#mode === MANAGER_MODE.SERVING
      ? { mode: HANDOVER_MODE.SERVING, safe: false, blocking }
      : this.drainingHandover(now, blocking)
    return poolSchemaForConfig(this.options.config.controlPlane).parse({
      apiVersion: CONTROL_PLANE_API_VERSION,
      poolId: this.options.config.controlPlane.poolId,
      managerInstanceId: this.options.managerInstanceId,
      mode: this.#mode,
      handover,
      counts: {
        physical: CONTROL_PLANE_FIXED.activeWorkerCount,
        usableReachable,
        reconciledIdle: byState.idle,
        busy,
        unavailable,
        byState,
      },
      queue: {
        depth: this.options.queueDepth(),
        max: this.options.config.controlPlane.queueMax,
        oldestWaitMs: 0,
      },
      memory: projectPoolMemory({
        action: this.options.action(),
        config: this.options.config,
        ingressBody: this.options.ingressBody(),
        ingressConnection: this.options.ingressConnection(),
        result: this.options.result(),
        webSocket: this.options.webSocket(),
      }),
      generatedAt: isoTime(now),
    })
  }

  public async drainPool(command: ManagedPoolDrainCommand): Promise<Pool> {
    this.requireInstance(command.request.expectedManagerInstanceId)
    const now = this.now()
    if (Date.parse(command.request.deadlineAt) < now) throw stateConflict()
    if (this.#mode === MANAGER_MODE.SERVING) {
      this.#mode = MANAGER_MODE.DRAINING
      this.#cause = command.request.reason
      this.#drainEnteredAt = now
      this.#lastMutationAt = now
    }
    return this.readPool()
  }

  public async resumePool(command: ManagedPoolResumeCommand): Promise<Pool> {
    this.requireInstance(command.request.expectedManagerInstanceId)
    const current = await this.readPool()
    if (
      current.handover.mode !== HANDOVER_MODE.DRAINING ||
      current.handover.safeAt !== command.request.expectedSafeAt ||
      !current.handover.safe
    ) {
      throw stateConflict()
    }
    this.#mode = MANAGER_MODE.SERVING
    this.#cause = command.request.reason
    this.#lastMutationAt = this.now()
    return this.readPool()
  }

  public requireServing(): void {
    if (this.#mode !== MANAGER_MODE.SERVING) {
      throw new ManagedOperationsError({
        code: MANAGED_ERROR_CODE.MANAGER_DRAINING,
        message: "Managed pool is draining",
      })
    }
  }

  public markMutation(): void {
    this.#lastMutationAt = this.now()
  }

  public async shutdown(): Promise<void> {
    const now = this.now()
    if (this.#mode === MANAGER_MODE.SERVING) this.#drainEnteredAt = now
    this.#mode = MANAGER_MODE.DRAINING
    this.#cause = MANAGER_MODE_CAUSE.SHUTDOWN
    this.#lastMutationAt = now
  }

  private drainingHandover(now: number, blocking: BlockingCounts) {
    const safeAt = computeDrainSafeAt({
      drainEnteredAtMs: this.#drainEnteredAt,
      lastAcceptedOrTerminalAtMs: this.#lastMutationAt,
      idempotencyTtlMs: this.options.config.controlPlane.idempotencyTtlMs,
    })
    const proof = {
      nowMs: now,
      safeAtMs: safeAt,
      drainEnteredAtMs: this.#drainEnteredAt,
      lastAcceptedOrTerminalAtMs: this.#lastMutationAt,
      idempotencyTtlMs: this.options.config.controlPlane.idempotencyTtlMs,
      drainingManagerInstanceId: this.options.managerInstanceId,
      currentManagerInstanceId: this.options.managerInstanceId,
      blocking,
    }
    return {
      mode: HANDOVER_MODE.DRAINING,
      safe: handoverIsSafe(proof),
      managerInstanceId: this.options.managerInstanceId,
      cause: this.#cause,
      drainEnteredAt: isoTime(this.#drainEnteredAt),
      lastMutationAt: isoTime(this.#lastMutationAt),
      idempotencyTtlMs: this.options.config.controlPlane.idempotencyTtlMs,
      safeAt: isoTime(safeAt),
      blocking,
    }
  }

  private requireInstance(instanceId: ManagerInstanceId): void {
    if (instanceId !== this.options.managerInstanceId) throw stateConflict()
  }

  private now(): number {
    const value = this.options.clock.now()
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("manager clock rejected")
    return value
  }
}

function isoTime(milliseconds: number): string {
  return new Date(milliseconds).toISOString()
}

function stateConflict(): ManagedOperationsError {
  return new ManagedOperationsError({
    code: MANAGED_ERROR_CODE.SESSION_STATE_CONFLICT,
    message: "Managed pool transition precondition failed",
  })
}
