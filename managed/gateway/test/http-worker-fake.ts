import Fastify, { type FastifyInstance } from "fastify"
import {
  CREATE_JOURNAL_STATE,
  CreateTokenSchema,
  PRIVATE_SUPERVISOR_ERROR_CODE,
  PRIVATE_SUPERVISOR_ROUTE_ID,
  WORKER_IDENTITY_HEADER,
  MANAGED_CREATE_HEADER,
} from "@happycastle/steel-managed-shared"
import {
  PublicSessionIdSchema,
  requirePrivateSupervisorRoute,
  StaticWorkerEndpointSchema,
  UpstreamCreateRequestSchema,
  UpstreamSessionIdSchema,
  UpstreamSessionState,
  WorkerIdSchema,
  type InstanceId,
  type WorkerProvider,
  type UpstreamSessionId,
} from "../src/index.js"
import { instanceId, upstreamSessionId } from "./test-support.js"

const HTTP_METHOD = { POST: "POST" } as const
const CREATE_SESSION_PATH = "/v1/sessions"
const METADATA_URL = new URL(
  requirePrivateSupervisorRoute(PRIVATE_SUPERVISOR_ROUTE_ID.META).path,
  "http://worker.invalid",
)
const ACTIVE_CREATES_URL = new URL(
  requirePrivateSupervisorRoute(PRIVATE_SUPERVISOR_ROUTE_ID.CREATES_ACTIVE).path,
  "http://worker.invalid",
)

type LocalWorkerFakeOptions = {
  readonly workerSequence: number
  readonly instanceSequence: number
  readonly reportedWorkerSequence?: number
  readonly reportedInstanceSequence?: number
  readonly headerWorkerSequence?: number
  readonly headerInstanceSequence?: number
  readonly omitWorkerHeader?: boolean
  readonly omitInstanceHeader?: boolean
  readonly createStatus?: number
  readonly releaseStatus?: number
  readonly metadataStatus?: number
  readonly malformedMetadata?: boolean
  readonly releaseApplies?: boolean
  readonly reportedActiveCreateSessionId?: string
  readonly activeCreatesStatus?: number
  readonly metadataGate?: Promise<void>
  readonly onMetadata?: () => void
  readonly activeCreatesGate?: Promise<void>
  readonly onActiveCreates?: () => void
  readonly activeCreatesPaddingBytes?: number
  readonly gatedCreateSequence?: number
  readonly createResponseGate?: Promise<void>
  readonly onGatedCreate?: () => void
  readonly onCreateResponse?: () => void
}

export async function localWorkerProvider(
  first: LocalWorkerFake,
  second: LocalWorkerFake,
): Promise<WorkerProvider> {
  const workers = Object.freeze([
    StaticWorkerEndpointSchema.parse({ workerId: first.workerId, origin: await first.listen() }),
    StaticWorkerEndpointSchema.parse({ workerId: second.workerId, origin: await second.listen() }),
  ])
  return { list: () => workers }
}

export class LocalWorkerFake {
  /** The fake owns mutable singleton state to match the committed worker foundation. */
  private activeSessionId: UpstreamSessionId | undefined
  private readonly releasedSessionIds: UpstreamSessionId[] = []
  private readonly idleSessionId = upstreamSessionId(999)
  private readonly server: FastifyInstance
  public readonly workerId
  private readonly reportedWorkerId
  private readonly reportedInstanceId: InstanceId | undefined
  private readonly headerWorkerId: LocalWorkerFake["workerId"] | undefined
  private readonly headerInstanceId: InstanceId | undefined
  private readonly omitWorkerHeader: boolean
  private readonly omitInstanceHeader: boolean
  private currentInstanceId: InstanceId
  private readonly createStatus: number
  private readonly releaseStatus: number
  private readonly metadataStatus: number
  private readonly malformedMetadata: boolean
  private readonly releaseApplies: boolean
  private reportedActiveCreateSessionId: string | undefined
  private reportedPendingCreateState: PendingCreateState | undefined
  private activeCreatesStatus: number
  private metadataGate: Promise<void> | undefined
  private onMetadata: (() => void) | undefined
  private readonly activeCreatesGate: Promise<void> | undefined
  private readonly onActiveCreates: (() => void) | undefined
  private readonly activeCreatesPadding: string | undefined
  private readonly gatedCreateSequence: number | undefined
  private readonly createResponseGate: Promise<void> | undefined
  private readonly onGatedCreate: (() => void) | undefined
  private readonly onCreateResponse: (() => void) | undefined
  private createSequence = 0
  private releaseSequence = 0
  private lastManagedCreateHeaders: Readonly<Record<string, string | undefined>> | undefined

  public constructor(options: LocalWorkerFakeOptions) {
    this.workerId = WorkerIdSchema.parse(`worker-0${options.workerSequence}`)
    this.reportedWorkerId = WorkerIdSchema.parse(
      `worker-0${options.reportedWorkerSequence ?? options.workerSequence}`,
    )
    this.currentInstanceId = instanceId(options.instanceSequence)
    this.reportedInstanceId =
      options.reportedInstanceSequence === undefined
        ? undefined
        : instanceId(options.reportedInstanceSequence)
    this.headerWorkerId =
      options.headerWorkerSequence === undefined
        ? undefined
        : WorkerIdSchema.parse(`worker-0${options.headerWorkerSequence}`)
    this.headerInstanceId =
      options.headerInstanceSequence === undefined
        ? undefined
        : instanceId(options.headerInstanceSequence)
    this.omitWorkerHeader = options.omitWorkerHeader ?? false
    this.omitInstanceHeader = options.omitInstanceHeader ?? false
    this.createStatus = options.createStatus ?? 200
    this.releaseStatus = options.releaseStatus ?? 200
    this.metadataStatus = options.metadataStatus ?? 200
    this.malformedMetadata = options.malformedMetadata ?? false
    this.releaseApplies = options.releaseApplies ?? true
    this.reportedActiveCreateSessionId = options.reportedActiveCreateSessionId
    this.activeCreatesStatus = options.activeCreatesStatus ?? 200
    this.metadataGate = options.metadataGate
    this.onMetadata = options.onMetadata
    this.activeCreatesGate = options.activeCreatesGate
    this.onActiveCreates = options.onActiveCreates
    this.activeCreatesPadding =
      options.activeCreatesPaddingBytes === undefined
        ? undefined
        : "x".repeat(options.activeCreatesPaddingBytes)
    this.gatedCreateSequence = options.gatedCreateSequence
    this.createResponseGate = options.createResponseGate
    this.onGatedCreate = options.onGatedCreate
    this.onCreateResponse = options.onCreateResponse
    this.server = Fastify({ logger: false })
    this.registerRoutes()
  }

  public get instanceId(): InstanceId {
    return this.currentInstanceId
  }

  public restart(instanceSequence: number): void {
    this.currentInstanceId = instanceId(instanceSequence)
    this.activeSessionId = undefined
    this.reportedPendingCreateState = undefined
  }

  public reportActiveCreateSessionId(sessionId: string | undefined): void {
    this.reportedActiveCreateSessionId = sessionId
  }

  public reportPendingCreate(state: PendingCreateState | undefined): void {
    this.reportedPendingCreateState = state
  }

  public gateMetadata(gate: Promise<void> | undefined, onMetadata?: () => void): void {
    this.metadataGate = gate
    this.onMetadata = onMetadata
  }

  public get createRequestCount(): number {
    return this.createSequence
  }

  public get releaseRequestCount(): number {
    return this.releaseSequence
  }

  public get managedCreateHeaders(): Readonly<Record<string, string | undefined>> | undefined {
    return this.lastManagedCreateHeaders
  }

  public setActiveCreatesStatus(statusCode: number): void {
    this.activeCreatesStatus = statusCode
  }

  public async listen(): Promise<string> {
    const address = await this.server.listen({ host: "127.0.0.1", port: 0 })
    return address
  }

  public async close(): Promise<void> {
    await this.server.close()
  }

  private registerRoutes(): void {
    this.server.addHook("onSend", async (_request, reply, payload) => {
      if (!this.omitWorkerHeader) {
        reply.header(WORKER_IDENTITY_HEADER.WORKER_ID, this.headerWorkerId ?? this.workerId)
      }
      if (!this.omitInstanceHeader) {
        reply.header(
          WORKER_IDENTITY_HEADER.INSTANCE_ID,
          this.headerInstanceId ?? this.currentInstanceId,
        )
      }
      return payload
    })
    this.server.addHook("onResponse", async (request) => {
      if (request.method === HTTP_METHOD.POST && request.url === CREATE_SESSION_PATH) {
        this.onCreateResponse?.()
      }
    })
    this.server.get(METADATA_URL.pathname, async (_request, reply) => {
      this.onMetadata?.()
      if (this.metadataGate !== undefined) await this.metadataGate
      if (this.malformedMetadata) return reply.code(this.metadataStatus).send("not-json")
      return reply.code(this.metadataStatus).send({
        browserVersion: "150.0.7871.46",
        instanceId: this.reportedInstanceId ?? this.currentInstanceId,
        journalVersion: 1,
        upstreamSha: "5880b48c1af107219ff3d904edbb8f6b76bea9b6",
        workerId: this.reportedWorkerId,
      })
    })
    this.server.get<{ Querystring: { scope?: string } }>(
      ACTIVE_CREATES_URL.pathname,
      async (request, reply) => {
        this.onActiveCreates?.()
        if (this.activeCreatesGate !== undefined) await this.activeCreatesGate
        if (this.activeCreatesStatus !== 200) {
          return reply.code(this.activeCreatesStatus).send({
            code: PRIVATE_SUPERVISOR_ERROR_CODE.UPSTREAM_OBSERVATION_UNAVAILABLE,
          })
        }
        if (request.query.scope !== ACTIVE_CREATES_URL.searchParams.get("scope")) {
          return reply.code(404).send({ code: "NOT_FOUND" })
        }
        const sessionId = this.reportedActiveCreateSessionId ?? this.activeSessionId
        return {
          creates: this.reportedPendingCreateState === undefined
            ? sessionId === undefined ? [] : [this.liveCreateRecord(sessionId)]
            : [this.pendingCreateRecord(this.reportedPendingCreateState)],
          padding: this.activeCreatesPadding,
        }
      },
    )
    this.server.get("/v1/sessions", async () => {
      return {
        sessions: [
          this.activeSessionId === undefined
            ? { id: this.idleSessionId, status: UpstreamSessionState.IDLE }
            : { id: this.activeSessionId, status: UpstreamSessionState.LIVE },
          ...this.releasedSessionIds.map((id) => ({ id, status: UpstreamSessionState.RELEASED })),
        ],
      }
    })
    this.server.post("/v1/sessions", async (request, reply) => {
      this.lastManagedCreateHeaders = Object.fromEntries(
        Object.values(MANAGED_CREATE_HEADER).map((name) => {
          const value = request.headers[name]
          return [name, typeof value === "string" ? value : undefined]
        }),
      )
      if (this.createStatus !== 200) return reply.code(this.createStatus).send({ status: "failed" })
      const command = UpstreamCreateRequestSchema.parse(request.body)
      this.createSequence += 1
      const publicSessionId = PublicSessionIdSchema.parse(command.sessionId)
      this.activeSessionId = UpstreamSessionIdSchema.parse(publicSessionId)
      this.reportedPendingCreateState = undefined
      if (this.createSequence === this.gatedCreateSequence) {
        this.onGatedCreate?.()
        if (this.createResponseGate !== undefined) await this.createResponseGate
      }
      return { id: this.activeSessionId, status: UpstreamSessionState.LIVE }
    })
    this.server.post<{ Params: { upstreamSessionId: string } }>(
      "/v1/sessions/:upstreamSessionId/release",
      async (_request, reply) => {
        this.releaseSequence += 1
        const released = this.activeSessionId ?? this.idleSessionId
        if (this.releaseApplies) {
          this.activeSessionId = undefined
          this.releasedSessionIds.push(released)
        }
        if (this.releaseStatus !== 200) {
          return reply.code(this.releaseStatus).send({ status: UpstreamSessionState.FAILED })
        }
        return { success: true, id: released, status: UpstreamSessionState.RELEASED }
      },
    )
  }

  private createRecordFields() {
    return {
      expiresAt: "2026-07-21T00:10:00.000Z",
      ownerSha256: "a".repeat(64),
      requestSha256: "b".repeat(64),
      token: CreateTokenSchema.parse(`h1_${"c".repeat(64)}`),
      updatedAt: "2026-07-21T00:00:00.000Z",
    }
  }

  private liveCreateRecord(sessionId: string) {
    return {
      ...this.createRecordFields(),
      replay: {
        bodyTemplate: { id: sessionId, status: UpstreamSessionState.LIVE },
        headers: { contentType: "application/json; charset=utf-8" },
        status: 200,
      },
      state: CREATE_JOURNAL_STATE.LIVE,
      upstreamSessionId: sessionId,
    }
  }

  private pendingCreateRecord(state: PendingCreateState) {
    return { ...this.createRecordFields(), state }
  }
}

type PendingCreateState =
  | typeof CREATE_JOURNAL_STATE.ACCEPTED
  | typeof CREATE_JOURNAL_STATE.UNCERTAIN
  | typeof CREATE_JOURNAL_STATE.UPSTREAM_PENDING
