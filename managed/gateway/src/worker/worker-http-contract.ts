import { z } from "zod"
import {
  InstanceIdSchema,
  PublicSessionIdSchema,
  WorkerIdSchema,
  type PublicSessionId,
  type UpstreamSessionId,
} from "../domain/ids.js"
import type { WorkerRemoteState } from "../domain/states.js"
import type { RecoverableSession, WorkerDescriptor } from "../registry/registry-model.js"
import type { StaticWorkerEndpoint } from "./static-worker-provider.js"

export const WorkerPath = {
  ACTIVE_SESSION: "/v1/managed-worker/active-session",
  META: "/v1/managed-worker/meta",
  SESSIONS: "/v1/sessions",
} as const

export const WorkerHeader = {
  INSTANCE_ID: "x-managed-worker-instance-id",
  WORKER_ID: "x-managed-worker-id",
} as const

export const WorkerBootStatus = {
  BOOTSTRAPPING: "BOOTSTRAPPING",
  READY: "READY",
} as const
export type WorkerBootStatus = (typeof WorkerBootStatus)[keyof typeof WorkerBootStatus]

export const UpstreamSessionState = {
  FAILED: "failed",
  IDLE: "idle",
  LIVE: "live",
  RELEASED: "released",
} as const
export type UpstreamSessionState =
  (typeof UpstreamSessionState)[keyof typeof UpstreamSessionState]

const WorkerBootStatusSchema = z.union([
  z.literal(WorkerBootStatus.BOOTSTRAPPING),
  z.literal(WorkerBootStatus.READY),
])

export const WorkerMetaResponseSchema = z
  .object({
    workerId: WorkerIdSchema,
    instanceId: InstanceIdSchema,
    status: WorkerBootStatusSchema,
  })
  .strict()
  .readonly()

const ActiveSessionSchema = z
  .object({
    id: PublicSessionIdSchema,
    status: z.literal(UpstreamSessionState.LIVE),
  })
  .strict()
  .readonly()

export const WorkerActiveSessionResponseSchema = z
  .object({
    workerId: WorkerIdSchema,
    instanceId: InstanceIdSchema,
    activeSession: ActiveSessionSchema.nullable(),
  })
  .strict()
  .readonly()

export const UpstreamSessionStateSchema = z.union([
  z.literal(UpstreamSessionState.FAILED),
  z.literal(UpstreamSessionState.IDLE),
  z.literal(UpstreamSessionState.LIVE),
  z.literal(UpstreamSessionState.RELEASED),
])

export const UpstreamSessionResponseSchema = z
  .object({
    id: z.string().uuid(),
    status: UpstreamSessionStateSchema,
  })
  .passthrough()
  .readonly()

export const UpstreamReleaseResponseSchema = UpstreamSessionResponseSchema.and(
  z.object({ success: z.literal(true) }).passthrough().readonly(),
)

export const WorkerCreateCommandSchema = z
  .object({ publicSessionId: PublicSessionIdSchema })
  .strict()
  .readonly()
export type WorkerCreateCommand = z.infer<typeof WorkerCreateCommandSchema>

export const UpstreamCreateRequestSchema = z
  .object({ sessionId: PublicSessionIdSchema })
  .strict()
  .readonly()

export type WorkerProbe = {
  readonly worker: WorkerDescriptor
  readonly remoteState: WorkerRemoteState
  readonly sessions: readonly RecoverableSession[]
}

export type WorkerListResult = WorkerProbe

export type WorkerCreateResult = {
  readonly worker: WorkerDescriptor
  readonly upstreamSessionId: UpstreamSessionId
}

export interface WorkerHttpClient {
  probe(endpoint: StaticWorkerEndpoint, signal: AbortSignal): Promise<WorkerProbe>
  list(worker: WorkerDescriptor, signal: AbortSignal): Promise<WorkerListResult>
  create(
    worker: WorkerDescriptor,
    command: WorkerCreateCommand,
    signal: AbortSignal,
  ): Promise<WorkerCreateResult>
  release(
    worker: WorkerDescriptor,
    upstreamSessionId: UpstreamSessionId,
    signal: AbortSignal,
  ): Promise<void>
}

export type { PublicSessionId }
