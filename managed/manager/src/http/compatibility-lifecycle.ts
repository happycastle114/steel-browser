import {
  AccessAuthenticationError,
  LifecycleCreateKind,
  NoReachableWorkerError,
  SessionState,
  UpstreamSessionState,
  type CompatibilityLifecycleRequest,
  type CompatibilityLifecycleResult,
  type CompatibilitySessionLifecycle,
  type LifecycleCreateResult,
  type PublicSessionId,
  type SessionRecord,
  type WorkerDescriptor,
} from "@happycastle/steel-managed-gateway"
import type {
  ManagedCreateHeaderValues,
  PrincipalId,
} from "@happycastle/steel-managed-shared"

type ManagerCompatibilityLifecycleOptions = Readonly<{
  admissions: Readonly<{
    releaseCompatibilitySession(
      principalId: PrincipalId,
      sessionId: PublicSessionId,
      signal: AbortSignal,
    ): Promise<SessionRecord>
    trackLifecycleResult(principalId: PrincipalId, result: LifecycleCreateResult): unknown
  }>
  lifecycle: Readonly<{
    create(
      signal: AbortSignal,
      createHeaders?: (publicSessionId: PublicSessionId) => Promise<ManagedCreateHeaderValues>,
    ): Promise<LifecycleCreateResult>
  }>
  createHeaders(
    principalId: PrincipalId,
    publicSessionId: PublicSessionId,
  ): Promise<ManagedCreateHeaderValues>
  pool: Readonly<{ requireServing(): void }>
  registry: Readonly<{
    session(sessionId: PublicSessionId): SessionRecord | undefined
    workerForSession(sessionId: PublicSessionId): WorkerDescriptor
  }>
  wait(milliseconds: number): Promise<void>
  waitMilliseconds: number
}>

export class ManagerCompatibilityLifecycle implements CompatibilitySessionLifecycle {
  public constructor(private readonly options: ManagerCompatibilityLifecycleOptions) {
    if (!Number.isSafeInteger(options.waitMilliseconds) || options.waitMilliseconds < 1) {
      throw new RangeError("compatibility wait must be positive")
    }
  }

  public async create(
    request: CompatibilityLifecycleRequest,
  ): Promise<CompatibilityLifecycleResult> {
    const principalId = requirePrincipal(request.principalId)
    this.options.pool.requireServing()
    const result = await this.options.lifecycle.create(
      request.signal,
      async (publicSessionId) => this.options.createHeaders(principalId, publicSessionId),
    )
    this.options.admissions.trackLifecycleResult(principalId, result)
    const session = result.kind === LifecycleCreateKind.CREATED
      ? result.session
      : await this.waitForSession(result.publicSessionId, request.signal)
    return {
      session,
      response: upstreamResponse(session, this.options.registry.workerForSession(session.publicSessionId)),
    }
  }

  public async release(
    sessionId: PublicSessionId,
    request: CompatibilityLifecycleRequest,
  ): Promise<CompatibilityLifecycleResult> {
    const principalId = requirePrincipal(request.principalId)
    const worker = this.options.registry.workerForSession(sessionId)
    const session = await this.options.admissions.releaseCompatibilitySession(
      principalId,
      sessionId,
      request.signal,
    )
    return { session, response: upstreamResponse(session, worker) }
  }

  private async waitForSession(
    sessionId: PublicSessionId,
    signal: AbortSignal,
  ): Promise<SessionRecord> {
    const deadline = Date.now() + this.options.waitMilliseconds
    while (!signal.aborted && Date.now() < deadline) {
      const session = this.options.registry.session(sessionId)
      if (session !== undefined) return session
      await this.options.wait(Math.min(25, Math.max(1, deadline - Date.now())))
    }
    throw new NoReachableWorkerError()
  }
}

function upstreamResponse(session: SessionRecord, worker: WorkerDescriptor) {
  const live = session.state === SessionState.LIVE || session.state === SessionState.RELEASING
  const workerUrl = new URL(worker.origin)
  const websocketUrl = new URL(worker.origin)
  websocketUrl.protocol = workerUrl.protocol === "https:" ? "wss:" : "ws:"
  return {
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: Buffer.from(JSON.stringify({
      id: session.publicSessionId,
      status: live ? UpstreamSessionState.LIVE : UpstreamSessionState.RELEASED,
      success: !live,
      websocketUrl: websocketUrl.href,
      debugUrl: new URL("/v1/sessions/debug", worker.origin).href,
      sessionViewerUrl: new URL("/", worker.origin).href,
    })),
  }
}

function requirePrincipal(principalId: PrincipalId | undefined): PrincipalId {
  if (principalId === undefined) {
    throw new AccessAuthenticationError("authenticated principal missing")
  }
  return principalId
}
