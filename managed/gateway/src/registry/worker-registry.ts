import type { Clock } from "../domain/clock.js"
import { WorkerRegistryTransitionError } from "../domain/errors.js"
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
import { SessionReleaseTransitions } from "./session-release-transitions.js"
import {
  createRegistryState,
  descriptor,
  findAllocation,
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
  private readonly releases: SessionReleaseTransitions

  public constructor(options: WorkerRegistryOptions) {
    this.state = createRegistryState(options)
    this.observations = new WorkerObservationTransitions(this.state)
    this.releases = new SessionReleaseTransitions(this.state)
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
    return this.releases.begin(sessionId)
  }

  public reconcileReleased(sessionId: PublicSessionId, worker: WorkerDescriptor): SessionRecord {
    return this.releases.reconcile(sessionId, worker)
  }

  public markReleaseUncertain(sessionId: PublicSessionId): SessionRecord {
    return this.releases.markUncertain(sessionId)
  }

  public cancelRelease(sessionId: PublicSessionId): SessionRecord {
    return this.releases.cancel(sessionId)
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
