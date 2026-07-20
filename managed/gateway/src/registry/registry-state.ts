import type { Clock } from "../domain/clock.js"
import {
  DuplicateAllocationIdError,
  DuplicatePublicSessionIdError,
  SessionNotFoundError,
  StaleWorkerGenerationError,
  WorkerRegistryTransitionError,
} from "../domain/errors.js"
import type {
  AllocationId,
  InstanceId,
  PublicSessionId,
  WorkerId,
} from "../domain/ids.js"
import type { EventLedger } from "../events/event-ledger.js"
import type { SessionRecord, WorkerDescriptor, WorkerRecord } from "./registry-model.js"

export type RegistryState = {
  /** These maps are mutable because synchronous registry transitions own their state. */
  readonly workerRecords: Map<WorkerId, WorkerRecord>
  readonly workerRevisions: Map<WorkerId, number>
  readonly sessionRecords: Map<PublicSessionId, SessionRecord>
  readonly observationSequences: Map<WorkerId, number>
  readonly clock: Clock
  readonly ledger: EventLedger
}

type RegistryStateOptions = {
  readonly clock: Clock
  readonly ledger: EventLedger
}

export function createRegistryState(options: RegistryStateOptions): RegistryState {
  return {
    workerRecords: new Map(),
    workerRevisions: new Map(),
    sessionRecords: new Map(),
    observationSequences: new Map(),
    clock: options.clock,
    ledger: options.ledger,
  }
}

export function workerRevision(state: RegistryState, workerId: WorkerId): number {
  return state.workerRevisions.get(workerId) ?? 0
}

export function storeWorker(state: RegistryState, worker: WorkerRecord): void {
  state.workerRecords.set(worker.workerId, worker)
  state.workerRevisions.set(worker.workerId, workerRevision(state, worker.workerId) + 1)
}

export function descriptor(worker: WorkerRecord): WorkerDescriptor {
  return { workerId: worker.workerId, instanceId: worker.instanceId, origin: worker.origin }
}

export function sortedWorkers(state: RegistryState): readonly WorkerRecord[] {
  return [...state.workerRecords.values()].sort((left, right) =>
    left.workerId.localeCompare(right.workerId),
  )
}

export function findAllocation(state: RegistryState, allocationId: AllocationId): WorkerRecord {
  const worker = sortedWorkers(state).find(
    (candidate) => "allocationId" in candidate && candidate.allocationId === allocationId,
  )
  if (worker === undefined) throw new WorkerRegistryTransitionError(allocationId)
  return worker
}

export function requireAvailableAllocation(
  state: RegistryState,
  allocationId: AllocationId,
): void {
  const workerOwnsAllocation = [...state.workerRecords.values()].some(
    (worker) => "allocationId" in worker && worker.allocationId === allocationId,
  )
  const sessionOwnsAllocation = [...state.sessionRecords.values()].some(
    (session) => session.allocationId === allocationId,
  )
  if (workerOwnsAllocation || sessionOwnsAllocation) {
    throw new DuplicateAllocationIdError(allocationId)
  }
}

export function requireAvailableSession(
  state: RegistryState,
  sessionId: PublicSessionId,
): void {
  if (state.sessionRecords.has(sessionId)) throw new DuplicatePublicSessionIdError(sessionId)
}

export function requireSession(state: RegistryState, sessionId: PublicSessionId): SessionRecord {
  const session = state.sessionRecords.get(sessionId)
  if (session === undefined) throw new SessionNotFoundError(sessionId)
  return session
}

export function requireWorker(
  state: RegistryState,
  workerId: WorkerId,
  instanceId: InstanceId,
): WorkerRecord {
  const worker = state.workerRecords.get(workerId)
  if (worker === undefined || worker.instanceId !== instanceId) {
    throw new StaleWorkerGenerationError(workerId, instanceId)
  }
  return worker
}

export function requireCurrent(state: RegistryState, worker: WorkerDescriptor): WorkerRecord {
  return requireWorker(state, worker.workerId, worker.instanceId)
}
