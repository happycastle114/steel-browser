import { z } from "zod"
import {
  AllocationIdSchema,
  InstanceIdSchema,
  PublicSessionIdSchema,
  UpstreamSessionIdSchema,
  WorkerIdSchema,
  type AllocationId,
  type InstanceId,
  type PublicSessionId,
  type UpstreamSessionId,
  type WorkerId,
} from "../domain/ids.js"
import {
  ObservationCommitKind,
  SessionState,
  WorkerRemoteState,
  WorkerState,
  type SessionState as SessionStateValue,
  type WorkerState as WorkerStateValue,
} from "../domain/states.js"
import { WorkerOriginSchema } from "../worker/static-worker-provider.js"

export const WorkerDescriptorSchema = z.object({
  workerId: WorkerIdSchema,
  instanceId: InstanceIdSchema,
  origin: WorkerOriginSchema,
}).strict().readonly()
export type WorkerDescriptor = z.infer<typeof WorkerDescriptorSchema>

export const RecoverableSessionSchema = z.object({
  allocationId: AllocationIdSchema,
  publicSessionId: PublicSessionIdSchema,
  upstreamSessionId: UpstreamSessionIdSchema,
}).strict().readonly()
export type RecoverableSession = z.infer<typeof RecoverableSessionSchema>

export type WorkerObservation = {
  readonly workerId: WorkerId
  readonly sequence: number
  readonly registryRevision: number
}

export type CommittedWorkerObservation = {
  readonly worker: WorkerDescriptor
  readonly remoteState: WorkerRemoteState
  readonly sessions: readonly RecoverableSession[]
}

type WorkerBase = {
  readonly workerId: WorkerId
  readonly instanceId: InstanceId
  readonly origin: WorkerDescriptor["origin"]
  readonly observedAt: number
}

export type WorkerRecord =
  | (WorkerBase & { readonly state: typeof WorkerState.IDLE })
  | (WorkerBase & {
      readonly state: typeof WorkerState.RESERVED
      readonly allocationId: AllocationId
    })
  | (WorkerBase & {
      readonly state: typeof WorkerState.LIVE
      readonly allocationId: AllocationId
      readonly sessionId: PublicSessionId
    })
  | (WorkerBase & {
      readonly state: typeof WorkerState.RELEASING
      readonly allocationId: AllocationId
      readonly sessionId: PublicSessionId
    })
  | (WorkerBase & {
      readonly state:
        | typeof WorkerState.RELEASE_UNCERTAIN
        | typeof WorkerState.RELEASE_UNCERTAIN_UNREACHABLE
      readonly allocationId: AllocationId
      readonly sessionId: PublicSessionId
    })
  | (WorkerBase & {
      readonly state: typeof WorkerState.UNREACHABLE | typeof WorkerState.QUARANTINED
    })

type SessionBase = {
  readonly allocationId: AllocationId
  readonly publicSessionId: PublicSessionId
  readonly upstreamSessionId: UpstreamSessionId
  readonly workerId: WorkerId
  readonly instanceId: InstanceId
  readonly createdAt: number
}

export type SessionRecord =
  | (SessionBase & {
      readonly state: typeof SessionState.LIVE
    })
  | (SessionBase & {
      readonly state: typeof SessionState.RELEASING
    })
  | (SessionBase & {
      readonly state: typeof SessionState.RELEASED | typeof SessionState.LOST
      readonly terminalAt: number
    })

export type WorkerObservationCommit =
  | { readonly kind: typeof ObservationCommitKind.COMMITTED; readonly worker: WorkerRecord }
  | { readonly kind: typeof ObservationCommitKind.STALE_OBSERVATION }

export type BindSessionInput = {
  readonly allocationId: AllocationId
  readonly publicSessionId: PublicSessionId
  readonly upstreamSessionId: UpstreamSessionId
}

export type WorkerRegistrySnapshot = {
  readonly workers: readonly WorkerRecord[]
  readonly sessions: readonly SessionRecord[]
}

export type { AllocationId, PublicSessionId, SessionStateValue, WorkerStateValue }

export { SessionState, WorkerRemoteState, WorkerState }
