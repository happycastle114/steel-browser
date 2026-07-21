import {
  WorkerState as GatewayWorkerState,
  type ActionCapacitySnapshot,
  type WebSocketReservationSnapshot,
  type WorkerRecord,
} from "@happycastle/steel-managed-gateway"
import {
  CONTROL_PLANE_FIXED,
  type ResultReservationSnapshot,
} from "@happycastle/steel-managed-shared"
import type { ManagerConfig } from "../config.js"
import type { ReservationLedgerSnapshot } from "../memory/atomic-reservation-ledger.js"

export function projectPoolWorkerCounts(workers: readonly WorkerRecord[]) {
  const counts = {
    discovered: CONTROL_PLANE_FIXED.activeWorkerCount - workers.length,
    reachable: 0,
    idle: 0,
    reserved: 0,
    starting: 0,
    live: 0,
    releasing: 0,
    unreachable: 0,
    quarantined: 0,
    draining: 0,
  }
  for (const worker of workers) {
    switch (worker.state) {
      case GatewayWorkerState.IDLE: counts.idle += 1; break
      case GatewayWorkerState.RESERVED: counts.reserved += 1; break
      case GatewayWorkerState.LIVE: counts.live += 1; break
      case GatewayWorkerState.RELEASING:
      case GatewayWorkerState.RELEASE_UNCERTAIN: counts.releasing += 1; break
      case GatewayWorkerState.RELEASE_UNCERTAIN_UNREACHABLE:
      case GatewayWorkerState.UNREACHABLE: counts.unreachable += 1; break
      case GatewayWorkerState.QUARANTINED: counts.quarantined += 1; break
      default: unreachableWorker(worker)
    }
  }
  return counts
}

export function countUncertainWorkers(workers: readonly WorkerRecord[]): number {
  return workers.filter((worker) =>
    worker.state === GatewayWorkerState.RELEASE_UNCERTAIN ||
    worker.state === GatewayWorkerState.RELEASE_UNCERTAIN_UNREACHABLE
  ).length
}

export function projectPoolMemory(input: Readonly<{
  action: ActionCapacitySnapshot
  config: ManagerConfig
  ingressBody: ReservationLedgerSnapshot
  ingressConnection: ReservationLedgerSnapshot
  result: ResultReservationSnapshot
  webSocket: WebSocketReservationSnapshot
}>) {
  const config = input.config.controlPlane
  return {
    managerLimitBytes: config.memory.managerLimitBytes,
    baseP95Bytes: config.managerBaseP95Bytes,
    tmpfsLimitBytes: CONTROL_PLANE_FIXED.managerTmpfsLimitBytes,
    snapshotLimitBytes: CONTROL_PLANE_FIXED.listSnapshotBytes,
    dynamicLimitBytes: config.memory.dynamicLimitBytes,
    result: {
      reservedBytes: input.result.reservedBytes,
      limitBytes: config.memory.resultBudgetBytes,
      reservedCount: input.result.reservedCount,
      limitCount: config.memory.resultCountLimit,
    },
    action: {
      reservedBytes: input.action.active * config.memory.actionReservationBytes,
      limitBytes: config.memory.actionBudgetBytes,
      reservedCount: input.action.active,
      limitCount: input.action.limit,
    },
    webSocket: {
      reservedBytes: input.webSocket.reservedBytes,
      limitBytes: input.webSocket.limitBytes,
      reservedCount: input.webSocket.activeCount,
      limitCount: input.webSocket.limitCount,
    },
    ingressConnection: input.ingressConnection,
    ingressBody: input.ingressBody,
  }
}

function unreachableWorker(worker: never): never {
  throw new RangeError(`unreachable worker state: ${String(worker)}`)
}
