import { assertNever } from "../domain/exhaustive.js"
import type { WorkerId } from "../domain/ids.js"
import { GatewayEventType, SessionState, WorkerState } from "../domain/states.js"
import type { CommittedWorkerObservation, WorkerRecord } from "./registry-model.js"
import type { RegistryState } from "./registry-state.js"

type UncertainReleaseWorker = Extract<
  WorkerRecord,
  {
    readonly state:
      | typeof WorkerState.RELEASE_UNCERTAIN
      | typeof WorkerState.RELEASE_UNCERTAIN_UNREACHABLE
  }
>

export class SessionRecoveryTransitions {
  public constructor(private readonly state: RegistryState) {}

  public recoverBusyWorker(
    current: WorkerRecord | undefined,
    input: CommittedWorkerObservation,
    observedAt: number,
  ): WorkerRecord {
    const recovered = input.sessions.at(0)
    if (input.sessions.length !== 1 || recovered === undefined) {
      if (current !== undefined) this.loseCurrentSession(current)
      return { ...input.worker, observedAt, state: WorkerState.QUARANTINED }
    }
    if (current?.state === WorkerState.LIVE) {
      if (this.matchesCurrent(current, recovered)) return { ...current, observedAt }
      this.loseCurrentSession(current)
      return { ...input.worker, observedAt, state: WorkerState.QUARANTINED }
    }
    if (
      current !== undefined &&
      this.isReleaseUncertain(current) &&
      current.instanceId === input.worker.instanceId
    ) {
      return this.recoverUncertainRelease(current, input, recovered, observedAt)
    }
    const restored = this.restoreLostSession(current, input, recovered, observedAt)
    if (restored !== undefined) return restored
    if (
      this.state.sessionRecords.has(recovered.publicSessionId) ||
      this.allocationIsOwned(recovered.allocationId, input.worker.workerId)
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
    switch (worker.state) {
      case WorkerState.LIVE:
      case WorkerState.RELEASING:
      case WorkerState.RELEASE_UNCERTAIN:
      case WorkerState.RELEASE_UNCERTAIN_UNREACHABLE:
        break
      case WorkerState.IDLE:
      case WorkerState.RESERVED:
      case WorkerState.UNREACHABLE:
      case WorkerState.QUARANTINED:
        return
      default:
        return assertNever(worker)
    }
    const session = this.state.sessionRecords.get(worker.sessionId)
    if (session === undefined) return
    switch (session.state) {
      case SessionState.LIVE:
      case SessionState.RELEASING:
        break
      case SessionState.RELEASED:
      case SessionState.LOST:
        return
      default:
        return assertNever(session)
    }
    const lost = { ...session, state: SessionState.LOST, terminalAt: this.state.clock.now() } as const
    this.state.sessionRecords.set(session.publicSessionId, lost)
    this.state.ledger.append({
      type: GatewayEventType.SESSION_LOST,
      workerId: worker.workerId,
      instanceId: worker.instanceId,
      allocationId: worker.allocationId,
      sessionId: worker.sessionId,
    })
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
      this.loseCurrentSession(worker)
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
      this.loseCurrentSession(worker)
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

  private allocationIsOwned(
    allocationId: CommittedWorkerObservation["sessions"][number]["allocationId"],
    observedWorkerId: WorkerId,
  ): boolean {
    const workerOwnsAllocation = [...this.state.workerRecords.values()].some(
      (worker) =>
        worker.workerId !== observedWorkerId &&
        "allocationId" in worker &&
        worker.allocationId === allocationId,
    )
    const sessionOwnsAllocation = [...this.state.sessionRecords.values()].some(
      (session) => session.allocationId === allocationId,
    )
    return workerOwnsAllocation || sessionOwnsAllocation
  }

  private isReleaseUncertain(worker: WorkerRecord): worker is UncertainReleaseWorker {
    return (
      worker.state === WorkerState.RELEASE_UNCERTAIN ||
      worker.state === WorkerState.RELEASE_UNCERTAIN_UNREACHABLE
    )
  }

  private restoreLostSession(
    current: WorkerRecord | undefined,
    input: CommittedWorkerObservation,
    recovered: CommittedWorkerObservation["sessions"][number],
    observedAt: number,
  ): WorkerRecord | undefined {
    if (current?.state !== WorkerState.UNREACHABLE) return undefined
    const lost = this.state.sessionRecords.get(recovered.publicSessionId)
    if (
      lost?.state !== SessionState.LOST ||
      lost.workerId !== input.worker.workerId ||
      lost.instanceId !== input.worker.instanceId ||
      lost.upstreamSessionId !== recovered.upstreamSessionId
    ) {
      return undefined
    }
    const session = {
      allocationId: lost.allocationId,
      publicSessionId: lost.publicSessionId,
      upstreamSessionId: lost.upstreamSessionId,
      workerId: lost.workerId,
      instanceId: lost.instanceId,
      createdAt: lost.createdAt,
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
}
