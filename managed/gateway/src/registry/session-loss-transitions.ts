import { assertNever } from "../domain/exhaustive.js"
import type { WorkerId } from "../domain/ids.js"
import { GatewayEventType, SessionState, WorkerState } from "../domain/states.js"
import type { CommittedWorkerObservation, WorkerRecord } from "./registry-model.js"
import type { RegistryState } from "./registry-state.js"

export class SessionLossTransitions {
  public constructor(private readonly state: RegistryState) {}

  public lose(worker: WorkerRecord): void {
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

  public restore(
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

  public allocationIsOwned(
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
}
