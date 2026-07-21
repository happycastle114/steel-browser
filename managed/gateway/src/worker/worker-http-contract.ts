import { z } from "zod"
import {
  ManagedCreateHeaderValuesSchema,
  PRIVATE_SUPERVISOR_ROUTE_REGISTRY,
  type PrivateSupervisorRoute,
} from "@happycastle/steel-managed-shared"
import {
  PublicSessionIdSchema,
  type PublicSessionId,
  type UpstreamSessionId,
} from "../domain/ids.js"
import type { WorkerRemoteState } from "../domain/states.js"
import type { RecoverableSession, WorkerDescriptor } from "../registry/registry-model.js"
import type { StaticWorkerEndpoint } from "./static-worker-provider.js"

export const UpstreamWorkerPath = {
  SESSIONS: "/v1/sessions",
} as const

export const WorkerPath = UpstreamWorkerPath

export function requirePrivateSupervisorRoute(
  id: PrivateSupervisorRoute["id"],
): PrivateSupervisorRoute {
  const route = PRIVATE_SUPERVISOR_ROUTE_REGISTRY.find((candidate) => candidate.id === id)
  if (route === undefined) throw new TypeError(`private supervisor route not registered: ${id}`)
  return route
}

export const UpstreamSessionState = {
  FAILED: "failed",
  IDLE: "idle",
  LIVE: "live",
  RELEASED: "released",
} as const
export type UpstreamSessionState =
  (typeof UpstreamSessionState)[keyof typeof UpstreamSessionState]

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
  .object({
    managedCreate: ManagedCreateHeaderValuesSchema.optional(),
    publicSessionId: PublicSessionIdSchema,
  })
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
