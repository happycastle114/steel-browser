import { SessionNotFoundError } from "../domain/errors.js"
import type { PublicSessionId } from "../domain/ids.js"
import { GatewayEventType, SessionState, WorkerState } from "../domain/states.js"
import type { SessionRecord, WorkerDescriptor } from "./registry-model.js"
import {
  requireCurrent,
  requireSession,
  requireWorker,
  storeWorker,
  type RegistryState,
} from "./registry-state.js"

export class SessionReleaseTransitions {
  public constructor(private readonly state: RegistryState) {}

  public begin(sessionId: PublicSessionId): SessionRecord {
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

  public reconcile(sessionId: PublicSessionId, worker: WorkerDescriptor): SessionRecord {
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

  public markUncertain(sessionId: PublicSessionId): SessionRecord {
    const { session, worker } = this.requireReleasing(sessionId)
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

  public cancel(sessionId: PublicSessionId): SessionRecord {
    const { session, worker } = this.requireReleasing(sessionId)
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

  private requireReleasing(sessionId: PublicSessionId) {
    const session = requireSession(this.state, sessionId)
    const worker = requireWorker(this.state, session.workerId, session.instanceId)
    if (
      session.state !== SessionState.RELEASING ||
      worker.state !== WorkerState.RELEASING ||
      worker.sessionId !== sessionId
    ) {
      throw new SessionNotFoundError(sessionId)
    }
    return { session, worker }
  }
}
