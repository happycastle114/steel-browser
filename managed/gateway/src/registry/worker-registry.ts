import type { Clock } from "../domain/clock.js"
import { SessionNotFoundError, WorkerRegistryTransitionError } from "../domain/errors.js"
import type { AllocationId, PublicSessionId, WorkerId } from "../domain/ids.js"
import { GatewayEventType, SessionState, WorkerState } from "../domain/states.js"
import type { EventLedger } from "../events/event-ledger.js"
import type {
  BindSessionInput,
  CommittedWorkerObservation,
  SessionRecord,
  WorkerDescriptor,
  WorkerObservation,
  WorkerObservationCommit,
  WorkerRecord,
  WorkerRegistrySnapshot,
} from "./registry-model.js"
import { WorkerObservationTransitions } from "./worker-observation-transitions.js"
import {
  createRegistryState,
  descriptor,
  findAllocation,
  requireCurrent,
  requireAvailableAllocation,
  requireAvailableSession,
  requireSession,
  requireWorker,
  sortedWorkers,
  storeWorker,
  type RegistryState,
} from "./registry-state.js"

type WorkerRegistryOptions = {
  readonly clock: Clock
  readonly ledger: EventLedger
}

export class WorkerRegistry {
  private readonly state: RegistryState
  private readonly observations: WorkerObservationTransitions

  public constructor(options: WorkerRegistryOptions) {
    this.state = createRegistryState(options)
    this.observations = new WorkerObservationTransitions(this.state)
  }

  public beginObservation(workerId: WorkerId): WorkerObservation {
    return this.observations.begin(workerId)
  }

  public commitObservation(
    observation: WorkerObservation,
    input: CommittedWorkerObservation,
  ): WorkerObservationCommit {
    return this.observations.commit(observation, input)
  }

  public reserveNext(allocationId: AllocationId): WorkerDescriptor | undefined {
    requireAvailableAllocation(this.state, allocationId)
    const idle = this.workers().find(({ state }) => state === WorkerState.IDLE)
    if (idle === undefined) return undefined
    const reserved = { ...idle, state: WorkerState.RESERVED, allocationId } as const
    storeWorker(this.state, reserved)
    this.state.ledger.append({
      type: GatewayEventType.SESSION_RESERVED,
      workerId: idle.workerId,
      instanceId: idle.instanceId,
      allocationId,
    })
    return descriptor(reserved)
  }

  public commitUnreachable(observation: WorkerObservation): boolean {
    return this.observations.commitUnreachable(observation)
  }

  public cancelReservation(allocationId: AllocationId): void {
    const worker = findAllocation(this.state, allocationId)
    if (worker.state !== WorkerState.RESERVED) {
      throw new WorkerRegistryTransitionError(allocationId)
    }
    storeWorker(this.state, {
      ...descriptor(worker),
      state: WorkerState.IDLE,
      observedAt: this.state.clock.now(),
    })
  }

  public quarantineReservation(allocationId: AllocationId): void {
    const worker = findAllocation(this.state, allocationId)
    if (worker.state !== WorkerState.RESERVED) {
      throw new WorkerRegistryTransitionError(allocationId)
    }
    storeWorker(this.state, {
      ...descriptor(worker),
      state: WorkerState.QUARANTINED,
      observedAt: this.state.clock.now(),
    })
    this.state.ledger.append({
      type: GatewayEventType.WORKER_QUARANTINED,
      workerId: worker.workerId,
      instanceId: worker.instanceId,
      allocationId,
    })
  }

  public bindSession(input: BindSessionInput): SessionRecord {
    const worker = findAllocation(this.state, input.allocationId)
    if (worker.state !== WorkerState.RESERVED) {
      throw new WorkerRegistryTransitionError(input.allocationId)
    }
    requireAvailableSession(this.state, input.publicSessionId)
    const createdAt = this.state.clock.now()
    const session = {
      ...input,
      workerId: worker.workerId,
      instanceId: worker.instanceId,
      createdAt,
      state: SessionState.LIVE,
    } as const
    this.state.sessionRecords.set(input.publicSessionId, session)
    storeWorker(this.state, {
      ...descriptor(worker),
      observedAt: createdAt,
      state: WorkerState.LIVE,
      allocationId: input.allocationId,
      sessionId: input.publicSessionId,
    })
    this.state.ledger.append({
      type: GatewayEventType.SESSION_BOUND,
      workerId: worker.workerId,
      instanceId: worker.instanceId,
      allocationId: input.allocationId,
      sessionId: input.publicSessionId,
    })
    return session
  }

  public beginRelease(sessionId: PublicSessionId): SessionRecord {
    const session = requireSession(this.state, sessionId)
    if (session.state !== SessionState.LIVE) throw new SessionNotFoundError(sessionId)
    const worker = requireCurrent(this.state, {
      workerId: session.workerId,
      instanceId: session.instanceId,
      origin: requireWorker(this.state, session.workerId, session.instanceId).origin,
    })
    if (
      (worker.state !== WorkerState.LIVE && worker.state !== WorkerState.RELEASING) ||
      worker.sessionId !== sessionId
    ) {
      throw new SessionNotFoundError(sessionId)
    }
    const releasingSession = { ...session, state: SessionState.RELEASING } as const
    this.state.sessionRecords.set(sessionId, releasingSession)
    storeWorker(this.state, { ...worker, state: WorkerState.RELEASING })
    this.state.ledger.append({
      type: GatewayEventType.SESSION_RELEASING,
      workerId: worker.workerId,
      instanceId: worker.instanceId,
      allocationId: session.allocationId,
      sessionId,
    })
    return releasingSession
  }

  public reconcileReleased(sessionId: PublicSessionId, worker: WorkerDescriptor): SessionRecord {
    requireCurrent(this.state, worker)
    const session = requireSession(this.state, sessionId)
    if (
      session.state !== SessionState.RELEASING ||
      session.workerId !== worker.workerId ||
      session.instanceId !== worker.instanceId
    ) {
      throw new SessionNotFoundError(sessionId)
    }
    const terminalAt = this.state.clock.now()
    const released = { ...session, state: SessionState.RELEASED, terminalAt } as const
    this.state.sessionRecords.set(sessionId, released)
    storeWorker(this.state, {
      ...worker,
      state: WorkerState.IDLE,
      observedAt: terminalAt,
    })
    this.state.ledger.append({
      type: GatewayEventType.SESSION_RELEASED,
      workerId: worker.workerId,
      instanceId: worker.instanceId,
      allocationId: session.allocationId,
      sessionId,
    })
    return released
  }

  public markReleaseUncertain(sessionId: PublicSessionId): SessionRecord {
    const session = requireSession(this.state, sessionId)
    const worker = requireWorker(this.state, session.workerId, session.instanceId)
    if (
      session.state !== SessionState.RELEASING ||
      worker.state !== WorkerState.RELEASING ||
      worker.sessionId !== sessionId
    ) {
      throw new SessionNotFoundError(sessionId)
    }
    storeWorker(this.state, { ...worker, state: WorkerState.RELEASE_UNCERTAIN })
    this.state.ledger.append({
      type: GatewayEventType.SESSION_RELEASE_UNCERTAIN,
      workerId: worker.workerId,
      instanceId: worker.instanceId,
      allocationId: session.allocationId,
      sessionId,
    })
    return session
  }

  public cancelRelease(sessionId: PublicSessionId): SessionRecord {
    const session = requireSession(this.state, sessionId)
    const worker = requireWorker(this.state, session.workerId, session.instanceId)
    if (
      session.state !== SessionState.RELEASING ||
      worker.state !== WorkerState.RELEASING ||
      worker.sessionId !== sessionId
    ) {
      throw new SessionNotFoundError(sessionId)
    }
    const live = { ...session, state: SessionState.LIVE } as const
    this.state.sessionRecords.set(sessionId, live)
    storeWorker(this.state, { ...worker, state: WorkerState.LIVE })
    this.state.ledger.append({
      type: GatewayEventType.SESSION_RELEASE_CANCELLED,
      workerId: worker.workerId,
      instanceId: worker.instanceId,
      allocationId: session.allocationId,
      sessionId,
    })
    return live
  }

  public session(sessionId: PublicSessionId): SessionRecord | undefined {
    return this.state.sessionRecords.get(sessionId)
  }

  public workerForSession(sessionId: PublicSessionId): WorkerDescriptor {
    const session = requireSession(this.state, sessionId)
    const worker = requireWorker(this.state, session.workerId, session.instanceId)
    return descriptor(worker)
  }

  public workers(): readonly WorkerRecord[] {
    return sortedWorkers(this.state)
  }

  public snapshot(): WorkerRegistrySnapshot {
    return { workers: this.workers(), sessions: [...this.state.sessionRecords.values()] }
  }

  public liveSessionIds(): readonly PublicSessionId[] {
    return [...this.state.sessionRecords.values()]
      .filter(({ state }) => state === SessionState.LIVE)
      .map(({ publicSessionId }) => publicSessionId)
  }

}
