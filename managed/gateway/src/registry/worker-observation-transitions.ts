import { assertNever } from "../domain/exhaustive.js"
import type { WorkerId } from "../domain/ids.js"
import {
  GatewayEventType,
  ObservationCommitKind,
  WorkerRemoteState,
  WorkerState,
} from "../domain/states.js"
import type {
  CommittedWorkerObservation,
  WorkerObservation,
  WorkerObservationCommit,
  WorkerRecord,
} from "./registry-model.js"
import {
  descriptor,
  storeWorker,
  workerRevision,
  type RegistryState,
} from "./registry-state.js"
import { SessionRecoveryTransitions } from "./session-recovery-transitions.js"

export class WorkerObservationTransitions {
  private readonly recovery: SessionRecoveryTransitions

  public constructor(private readonly state: RegistryState) {
    this.recovery = new SessionRecoveryTransitions(state)
  }

  public begin(workerId: WorkerId): WorkerObservation {
    const sequence = (this.state.observationSequences.get(workerId) ?? 0) + 1
    this.state.observationSequences.set(workerId, sequence)
    return { workerId, sequence, registryRevision: workerRevision(this.state, workerId) }
  }

  public commit(
    observation: WorkerObservation,
    input: CommittedWorkerObservation,
  ): WorkerObservationCommit {
    if (!this.isCurrent(observation)) {
      return { kind: ObservationCommitKind.STALE_OBSERVATION }
    }
    const current = this.state.workerRecords.get(observation.workerId)
    if (
      current !== undefined &&
      current.instanceId === input.worker.instanceId &&
      this.isTransient(current)
    ) {
      return { kind: ObservationCommitKind.STALE_OBSERVATION }
    }
    if (current !== undefined && current.instanceId !== input.worker.instanceId) {
      this.recovery.loseCurrentSession(current)
      this.state.ledger.append({
        type: GatewayEventType.WORKER_REPLACED,
        workerId: current.workerId,
        instanceId: current.instanceId,
      })
    }
    const worker = this.recordFromObservation(current, input)
    storeWorker(this.state, worker)
    this.state.ledger.append({
      type: GatewayEventType.WORKER_OBSERVED,
      workerId: worker.workerId,
      instanceId: worker.instanceId,
    })
    return { kind: ObservationCommitKind.COMMITTED, worker }
  }

  public commitUnreachable(observation: WorkerObservation): boolean {
    if (!this.isCurrent(observation)) {
      return false
    }
    const current = this.state.workerRecords.get(observation.workerId)
    if (current === undefined) return true
    if (this.isTransient(current)) return false
    if (this.isReleaseUncertain(current)) {
      storeWorker(this.state, {
        ...current,
        observedAt: this.state.clock.now(),
        state: WorkerState.RELEASE_UNCERTAIN_UNREACHABLE,
      })
      return true
    }
    this.recovery.loseCurrentSession(current)
    storeWorker(this.state, {
      ...descriptor(current),
      observedAt: this.state.clock.now(),
      state: WorkerState.UNREACHABLE,
    })
    return true
  }

  private isCurrent(observation: WorkerObservation): boolean {
    return (
      this.state.observationSequences.get(observation.workerId) === observation.sequence &&
      workerRevision(this.state, observation.workerId) === observation.registryRevision
    )
  }

  private recordFromObservation(
    current: WorkerRecord | undefined,
    input: CommittedWorkerObservation,
  ): WorkerRecord {
    const observedAt = this.state.clock.now()
    switch (input.remoteState) {
      case WorkerRemoteState.UNAVAILABLE:
        if (
          current !== undefined &&
          current.instanceId === input.worker.instanceId &&
          this.isReleaseUncertain(current)
        ) {
          return {
            ...current,
            observedAt,
            state: WorkerState.RELEASE_UNCERTAIN_UNREACHABLE,
          }
        }
        if (current !== undefined) this.recovery.loseCurrentSession(current)
        return { ...input.worker, observedAt, state: WorkerState.UNREACHABLE }
      case WorkerRemoteState.BUSY:
        return this.recovery.recoverBusyWorker(current, input, observedAt)
      case WorkerRemoteState.IDLE:
        if (input.sessions.length > 0) {
          if (current !== undefined) this.recovery.loseCurrentSession(current)
          return { ...input.worker, observedAt, state: WorkerState.QUARANTINED }
        }
        if (
          current !== undefined &&
          this.isReleaseUncertain(current) &&
          current.instanceId === input.worker.instanceId
        ) {
          return this.recovery.finalizeUncertainRelease(current, input.worker, observedAt)
        }
        if (current !== undefined) this.recovery.loseCurrentSession(current)
        return { ...input.worker, observedAt, state: WorkerState.IDLE }
      default:
        return assertNever(input.remoteState)
    }
  }

  private isTransient(worker: WorkerRecord): boolean {
    switch (worker.state) {
      case WorkerState.RESERVED:
      case WorkerState.RELEASING:
        return true
      case WorkerState.RELEASE_UNCERTAIN:
      case WorkerState.RELEASE_UNCERTAIN_UNREACHABLE:
      case WorkerState.IDLE:
      case WorkerState.LIVE:
      case WorkerState.UNREACHABLE:
      case WorkerState.QUARANTINED:
        return false
      default:
        return assertNever(worker)
    }
  }

  private isReleaseUncertain(
    worker: WorkerRecord,
  ): worker is Extract<
    WorkerRecord,
    {
      readonly state:
        | typeof WorkerState.RELEASE_UNCERTAIN
        | typeof WorkerState.RELEASE_UNCERTAIN_UNREACHABLE
    }
  > {
    return (
      worker.state === WorkerState.RELEASE_UNCERTAIN ||
      worker.state === WorkerState.RELEASE_UNCERTAIN_UNREACHABLE
    )
  }

}
