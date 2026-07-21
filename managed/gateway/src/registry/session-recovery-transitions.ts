import { GatewayEventType, SessionState, WorkerState } from "../domain/states.js"
import type { CommittedWorkerObservation, WorkerRecord } from "./registry-model.js"
import type { RegistryState } from "./registry-state.js"
import { SessionLossTransitions } from "./session-loss-transitions.js"

type UncertainReleaseWorker = Extract<
  WorkerRecord,
  {
    readonly state:
      | typeof WorkerState.RELEASE_UNCERTAIN
      | typeof WorkerState.RELEASE_UNCERTAIN_UNREACHABLE
  }
>

export class SessionRecoveryTransitions {
  private readonly losses: SessionLossTransitions

  public constructor(private readonly state: RegistryState) {
    this.losses = new SessionLossTransitions(state)
  }

  public recoverBusyWorker(
    current: WorkerRecord | undefined,
    input: CommittedWorkerObservation,
    observedAt: number,
  ): WorkerRecord {
    const recovered = input.sessions.at(0)
    if (input.sessions.length !== 1 || recovered === undefined) {
      if (current !== undefined) this.losses.lose(current)
      return { ...input.worker, observedAt, state: WorkerState.QUARANTINED }
    }
    if (current?.state === WorkerState.LIVE) {
      if (this.matchesCurrent(current, recovered)) return { ...current, observedAt }
      this.losses.lose(current)
      return { ...input.worker, observedAt, state: WorkerState.QUARANTINED }
    }
    if (
      current !== undefined &&
      this.isReleaseUncertain(current) &&
      current.instanceId === input.worker.instanceId
    ) {
      return this.recoverUncertainRelease(current, input, recovered, observedAt)
    }
    const restored = this.losses.restore(current, input, recovered, observedAt)
    if (restored !== undefined) return restored
    if (
      this.state.sessionRecords.has(recovered.publicSessionId) ||
      this.losses.allocationIsOwned(recovered.allocationId, input.worker.workerId)
    ) {
      return { ...input.worker, observedAt, state: WorkerState.QUARANTINED }
    }
    const session = {
      ...recovered,
      workerId: input.worker.workerId,
      instanceId: input.worker.instanceId,
      createdAt: observedAt,
      state: SessionState.LIVE,
    } as const
    this.state.sessionRecords.set(session.publicSessionId, session)
    return {
      ...input.worker,
      observedAt,
      state: WorkerState.LIVE,
      allocationId: session.allocationId,
      sessionId: session.publicSessionId,
    }
  }

  public loseCurrentSession(worker: WorkerRecord): void {
    this.losses.lose(worker)
  }

  private matchesCurrent(
    worker: WorkerRecord & { readonly state: typeof WorkerState.LIVE },
    recovered: CommittedWorkerObservation["sessions"][number],
  ): boolean {
    const session = this.state.sessionRecords.get(worker.sessionId)
    if (session === undefined) return false
    return (
      recovered.publicSessionId === worker.sessionId &&
      recovered.upstreamSessionId === session.upstreamSessionId &&
      session.state === SessionState.LIVE
    )
  }

  public finalizeUncertainRelease(
    worker: UncertainReleaseWorker,
    observed: CommittedWorkerObservation["worker"],
    observedAt: number,
  ): WorkerRecord {
    const session = this.state.sessionRecords.get(worker.sessionId)
    if (
      session?.state !== SessionState.RELEASING ||
      session.workerId !== observed.workerId ||
      session.instanceId !== observed.instanceId
    ) {
      this.losses.lose(worker)
      return { ...observed, observedAt, state: WorkerState.QUARANTINED }
    }
    const released = { ...session, state: SessionState.RELEASED, terminalAt: observedAt } as const
    this.state.sessionRecords.set(session.publicSessionId, released)
    this.state.ledger.append({
      type: GatewayEventType.SESSION_RELEASED,
      workerId: worker.workerId,
      instanceId: worker.instanceId,
      allocationId: worker.allocationId,
      sessionId: worker.sessionId,
    })
    return { ...observed, observedAt, state: WorkerState.IDLE }
  }

  private recoverUncertainRelease(
    worker: UncertainReleaseWorker,
    input: CommittedWorkerObservation,
    recovered: CommittedWorkerObservation["sessions"][number],
    observedAt: number,
  ): WorkerRecord {
    const session = this.state.sessionRecords.get(worker.sessionId)
    if (
      session?.state !== SessionState.RELEASING ||
      recovered.publicSessionId !== worker.sessionId ||
      recovered.upstreamSessionId !== session.upstreamSessionId
    ) {
      this.losses.lose(worker)
      return { ...input.worker, observedAt, state: WorkerState.QUARANTINED }
    }
    const live = { ...session, state: SessionState.LIVE } as const
    this.state.sessionRecords.set(session.publicSessionId, live)
    this.state.ledger.append({
      type: GatewayEventType.SESSION_RELEASE_RECOVERED,
      workerId: worker.workerId,
      instanceId: worker.instanceId,
      allocationId: worker.allocationId,
      sessionId: worker.sessionId,
    })
    return {
      ...input.worker,
      observedAt,
      state: WorkerState.LIVE,
      allocationId: worker.allocationId,
      sessionId: worker.sessionId,
    }
  }

  private isReleaseUncertain(worker: WorkerRecord): worker is UncertainReleaseWorker {
    return (
      worker.state === WorkerState.RELEASE_UNCERTAIN ||
      worker.state === WorkerState.RELEASE_UNCERTAIN_UNREACHABLE
    )
  }

}
