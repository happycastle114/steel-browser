import {
  LifecycleCreateKind,
  PublicSessionIdSchema,
  type AdmissionQueue,
  type AdmissionTicketId,
  type PendingSessionCreate,
  type PublicSessionId,
  type LifecycleCreateResult,
  type SessionLifecycleCoordinator,
  type WorkerRegistry,
} from "@happycastle/steel-managed-gateway"
import {
  ADMISSION_STATE,
  AdmissionIdSchema,
  AdmissionSchema,
  CONTROL_PLANE_FIXED,
  MANAGED_ERROR_CODE,
  SessionIdSchema,
  canonicalJson,
  type ManagedCreateHeaderValues,
  type Admission,
  type AdmissionId,
  type OwnedAuthorizationResource,
  type PrincipalId,
  type Session,
  type SessionId,
} from "@happycastle/steel-managed-shared"
import {
  ManagedOperationsError,
  type ManagedAdmissionCreateCommand,
  type ManagedAdmissionMutationCommand,
  type ManagedSessionReleaseCommand,
} from "@happycastle/steel-managed-gateway"
import { projectAdmissionTicket, projectSessionRecord } from "./resource-projection.js"

type ManagedAdmissionCoordinatorOptions = Readonly<{
  admissions: Pick<
    AdmissionQueue<PendingSessionCreate>,
    "cancel" | "get" | "shutdown"
  >
  clock: Readonly<{ now(): number }>
  createHeaders(
    command: ManagedAdmissionCreateCommand,
    publicSessionId: PublicSessionId,
  ): Promise<ManagedCreateHeaderValues>
  ids: Readonly<{ nextAdmissionId(): AdmissionId }>
  lifecycle: Pick<SessionLifecycleCoordinator, "create" | "release">
  registry: Pick<WorkerRegistry, "session">
  ticketTtlMilliseconds: number
}>

type TrackedAdmission = Readonly<{
  admissionId: AdmissionId
  createdAt: number
  expiresAt: number
  gatewayTicketId?: AdmissionTicketId
  ownerId: PrincipalId
  sessionId: SessionId
}>
export class ManagedAdmissionCoordinator {
  readonly #records = new Map<AdmissionId, TrackedAdmission>()
  readonly #replays = new Map<string, Promise<AdmissionId>>()
  readonly #sessionOwners = new Map<SessionId, PrincipalId>()
  public constructor(private readonly options: ManagedAdmissionCoordinatorOptions) {
    if (
      !Number.isSafeInteger(options.ticketTtlMilliseconds) ||
      options.ticketTtlMilliseconds < 1
    ) {
      throw new RangeError("managed admission TTL must be positive")
    }
  }

  public async createAdmission(
    command: ManagedAdmissionCreateCommand,
  ): Promise<Admission> {
    const replayKey = canonicalJson({
      idempotencyKey: command.request.idempotencyKey,
      operation: command.request.operation,
      principalId: command.principalId,
    })
    const existing = this.#replays.get(replayKey)
    if (existing !== undefined) return this.project(await existing)
    if (this.#replays.size >= CONTROL_PLANE_FIXED.idempotencyMax) {
      throw new ManagedOperationsError({
        code: MANAGED_ERROR_CODE.MANAGED_IDEMPOTENCY_CAPACITY,
        message: "Managed admission replay capacity exhausted",
        retryAfterSeconds: 1,
      })
    }
    const pending = this.createOnce(command)
    this.#replays.set(replayKey, pending)
    try {
      return this.project(await pending)
    } catch (error) {
      if (this.#replays.get(replayKey) === pending) this.#replays.delete(replayKey)
      throw error
    }
  }

  public async cancelAdmission(
    command: ManagedAdmissionMutationCommand,
  ): Promise<Admission> {
    const record = this.requireOwnedAdmission(command.admissionId, command.principalId)
    if (record.gatewayTicketId === undefined) throw admissionStateConflict()
    this.options.admissions.cancel(record.gatewayTicketId)
    return this.project(record.admissionId)
  }

  public async captureQueue(): Promise<readonly Admission[]> {
    return [...this.#records.keys()].map((admissionId) => this.project(admissionId))
  }

  public async captureSessions(): Promise<readonly OwnedAuthorizationResource<Session>[]> {
    const sessions: OwnedAuthorizationResource<Session>[] = []
    for (const [sessionId, ownerId] of this.#sessionOwners) {
      const record = this.options.registry.session(PublicSessionIdSchema.parse(sessionId))
      if (record !== undefined) sessions.push({ ownerId, resource: projectSessionRecord(record) })
    }
    return sessions
  }

  public async findAdmission(
    admissionId: AdmissionId,
  ): Promise<OwnedAuthorizationResource<Admission> | undefined> {
    const record = this.#records.get(admissionId)
    return record === undefined
      ? undefined
      : { ownerId: record.ownerId, resource: this.project(admissionId) }
  }

  public async findSession(
    sessionId: SessionId,
  ): Promise<OwnedAuthorizationResource<Session> | undefined> {
    const ownerId = this.#sessionOwners.get(sessionId)
    const record = this.options.registry.session(PublicSessionIdSchema.parse(sessionId))
    return ownerId === undefined || record === undefined
      ? undefined
      : { ownerId, resource: projectSessionRecord(record) }
  }

  public async releaseSession(command: ManagedSessionReleaseCommand): Promise<Session> {
    return projectSessionRecord(await this.releaseCompatibilitySession(
      command.principalId,
      PublicSessionIdSchema.parse(command.sessionId),
      new AbortController().signal,
    ))
  }

  public async releaseCompatibilitySession(
    principalId: PrincipalId,
    sessionId: ReturnType<typeof PublicSessionIdSchema.parse>,
    signal: AbortSignal,
  ) {
    this.requireOwnedSession(SessionIdSchema.parse(sessionId), principalId)
    return this.options.lifecycle.release(sessionId, signal)
  }

  public shutdown(): void {
    this.options.admissions.shutdown()
  }

  private async createOnce(command: ManagedAdmissionCreateCommand): Promise<AdmissionId> {
    const result = await this.options.lifecycle.create(
      new AbortController().signal,
      async (publicSessionId) => this.options.createHeaders(command, publicSessionId),
    )
    return this.trackLifecycleResult(command.principalId, result)
  }

  public trackLifecycleResult(
    principalId: PrincipalId,
    result: LifecycleCreateResult,
  ): AdmissionId {
    const createdAt = this.options.clock.now()
    const admissionId = AdmissionIdSchema.parse(this.options.ids.nextAdmissionId())
    const sessionId = SessionIdSchema.parse(
      result.kind === LifecycleCreateKind.CREATED
        ? result.session.publicSessionId
        : result.publicSessionId,
    )
    const record: TrackedAdmission = {
      admissionId,
      createdAt,
      expiresAt: createdAt + this.options.ticketTtlMilliseconds,
      ...(result.kind === LifecycleCreateKind.QUEUED
        ? { gatewayTicketId: result.admissionTicketId }
        : {}),
      ownerId: principalId,
      sessionId,
    }
    this.#records.set(admissionId, record)
    this.#sessionOwners.set(sessionId, principalId)
    return admissionId
  }

  private project(admissionId: AdmissionId): Admission {
    const record = this.requireAdmission(admissionId)
    if (record.gatewayTicketId !== undefined) {
      const ticket = this.options.admissions.get(record.gatewayTicketId)
      if (ticket === undefined) throw admissionNotFound()
      return projectAdmissionTicket(record.admissionId, ticket)
    }
    return AdmissionSchema.parse({
      admissionId: record.admissionId,
      state: ADMISSION_STATE.ADMITTED,
      sessionId: record.sessionId,
      createdAt: new Date(record.createdAt).toISOString(),
      expiresAt: new Date(record.expiresAt).toISOString(),
      updatedAt: new Date(record.createdAt).toISOString(),
    })
  }

  private requireAdmission(admissionId: AdmissionId): TrackedAdmission {
    const record = this.#records.get(admissionId)
    if (record === undefined) throw admissionNotFound()
    return record
  }

  private requireOwnedAdmission(
    admissionId: AdmissionId,
    principalId: PrincipalId,
  ): TrackedAdmission {
    const record = this.requireAdmission(admissionId)
    if (record.ownerId !== principalId) throw admissionNotFound()
    return record
  }

  private requireOwnedSession(sessionId: SessionId, principalId: PrincipalId): void {
    if (this.#sessionOwners.get(sessionId) !== principalId) {
      throw new ManagedOperationsError({
        code: MANAGED_ERROR_CODE.SESSION_NOT_FOUND,
        message: "Managed session was not found",
      })
    }
  }
}

function admissionNotFound(): ManagedOperationsError {
  return new ManagedOperationsError({
    code: MANAGED_ERROR_CODE.ADMISSION_NOT_FOUND,
    message: "Managed admission was not found",
  })
}

function admissionStateConflict(): ManagedOperationsError {
  return new ManagedOperationsError({
    code: MANAGED_ERROR_CODE.SESSION_STATE_CONFLICT,
    message: "Managed admission is already settled",
  })
}
