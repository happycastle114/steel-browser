import Fastify, { type FastifyInstance } from "fastify"
import {
  PublicSessionIdSchema,
  StaticWorkerEndpointSchema,
  UpstreamCreateRequestSchema,
  UpstreamSessionIdSchema,
  UpstreamSessionState,
  WorkerBootStatus,
  WorkerIdSchema,
  type InstanceId,
  type WorkerProvider,
  type UpstreamSessionId,
} from "../src/index.js"
import { instanceId, upstreamSessionId } from "./test-support.js"

const HTTP_METHOD = { POST: "POST" } as const
const CREATE_SESSION_PATH = "/v1/sessions"

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
  readonly reportedActiveSessionId?: string
  readonly activeSessionStatus?: number
  readonly metadataGate?: Promise<void>
  readonly onMetadata?: () => void
  readonly sessionListGate?: Promise<void>
  readonly onSessionList?: () => void
  readonly sessionListPaddingBytes?: number
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
  private reportedActiveSessionId: string | undefined
  private activeSessionStatus: number
  private metadataGate: Promise<void> | undefined
  private onMetadata: (() => void) | undefined
  private readonly sessionListGate: Promise<void> | undefined
  private readonly onSessionList: (() => void) | undefined
  private readonly sessionListPadding: string | undefined
  private readonly gatedCreateSequence: number | undefined
  private readonly createResponseGate: Promise<void> | undefined
  private readonly onGatedCreate: (() => void) | undefined
  private readonly onCreateResponse: (() => void) | undefined
  private createSequence = 0
  private releaseSequence = 0

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
    this.reportedActiveSessionId = options.reportedActiveSessionId
    this.activeSessionStatus = options.activeSessionStatus ?? 200
    this.metadataGate = options.metadataGate
    this.onMetadata = options.onMetadata
    this.sessionListGate = options.sessionListGate
    this.onSessionList = options.onSessionList
    this.sessionListPadding =
      options.sessionListPaddingBytes === undefined
        ? undefined
        : "x".repeat(options.sessionListPaddingBytes)
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
  }

  public reportActiveSessionId(sessionId: string | undefined): void {
    this.reportedActiveSessionId = sessionId
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

  public setActiveSessionStatus(statusCode: number): void {
    this.activeSessionStatus = statusCode
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
        reply.header("x-managed-worker-id", this.headerWorkerId ?? this.workerId)
      }
      if (!this.omitInstanceHeader) {
        reply.header(
          "x-managed-worker-instance-id",
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
    this.server.get("/v1/managed-worker/meta", async (_request, reply) => {
      this.onMetadata?.()
      if (this.metadataGate !== undefined) await this.metadataGate
      if (this.malformedMetadata) return reply.code(this.metadataStatus).send("not-json")
      return reply.code(this.metadataStatus).send({
        workerId: this.reportedWorkerId,
        instanceId: this.reportedInstanceId ?? this.currentInstanceId,
        status: WorkerBootStatus.READY,
      })
    })
    this.server.get("/v1/managed-worker/active-session", async (_request, reply) => {
      this.onSessionList?.()
      if (this.sessionListGate !== undefined) await this.sessionListGate
      if (this.activeSessionStatus !== 200) {
        return reply.code(this.activeSessionStatus).send({ status: UpstreamSessionState.FAILED })
      }
      return {
        workerId: this.reportedWorkerId,
        instanceId: this.reportedInstanceId ?? this.currentInstanceId,
        activeSession:
          this.reportedActiveSessionId === undefined && this.activeSessionId === undefined
            ? null
            : {
                id: this.reportedActiveSessionId ?? this.activeSessionId,
                status: UpstreamSessionState.LIVE,
              },
        padding: this.sessionListPadding,
      }
    })
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
      if (this.createStatus !== 200) return reply.code(this.createStatus).send({ status: "failed" })
      const command = UpstreamCreateRequestSchema.parse(request.body)
      this.createSequence += 1
      const publicSessionId = PublicSessionIdSchema.parse(command.sessionId)
      this.activeSessionId = UpstreamSessionIdSchema.parse(publicSessionId)
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
}
