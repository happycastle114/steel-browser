import { z } from "zod"

import { ControlPlaneApiVersionSchema } from "./control-plane-contract.js"
import {
  AdmissionIdSchema,
  CreateTokenKeyIdSchema,
  GitCommitShaSchema,
  InstanceIdSchema,
  IsoTimeSchema,
  MillisecondCountSchema,
  OciDigestSchema,
  OpaqueCursorSchema,
  SafeCountSchema,
  SessionIdSchema,
  Sha256Schema,
  WorkerIdSchema,
} from "./control-plane-primitives.js"
import { AdmissionStateSchema, SessionStateSchema, WorkerStateSchema } from "./control-plane-vocabulary-schemas.js"
import { withDeepFrozenOutput } from "./deep-readonly.js"
import { MANAGED_RELEASE_EVIDENCE_MODE } from "./managed-release-evidence-vocabulary.js"

const FailureCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/u)

const WorkerBaseSchema = z.object({
  workerId: WorkerIdSchema,
  instanceId: InstanceIdSchema,
  state: WorkerStateSchema,
  sessionId: SessionIdSchema.optional(),
  lastSeenAt: IsoTimeSchema,
  stateChangedAt: IsoTimeSchema,
  failureCode: FailureCodeSchema.optional(),
}).strict()
export const WorkerSchema = withDeepFrozenOutput(WorkerBaseSchema)

const SessionBaseSchema = z.object({
  sessionId: SessionIdSchema,
  state: SessionStateSchema,
  workerId: WorkerIdSchema.optional(),
  instanceId: InstanceIdSchema.optional(),
  admissionId: AdmissionIdSchema.optional(),
  createdAt: IsoTimeSchema,
  startedAt: IsoTimeSchema.optional(),
  endedAt: IsoTimeSchema.optional(),
  failureCode: FailureCodeSchema.optional(),
}).strict()
export const SessionSchema = withDeepFrozenOutput(SessionBaseSchema)

const AdmissionBaseSchema = z.object({
  admissionId: AdmissionIdSchema,
  state: AdmissionStateSchema,
  position: SafeCountSchema.optional(),
  sessionId: SessionIdSchema.optional(),
  createdAt: IsoTimeSchema,
  expiresAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
  failureCode: FailureCodeSchema.optional(),
}).strict()
export const AdmissionSchema = withDeepFrozenOutput(AdmissionBaseSchema)

const VersionBaseSchema = z.object({
  apiVersion: ControlPlaneApiVersionSchema,
  upstreamSha: GitCommitShaSchema,
  managedSha: GitCommitShaSchema,
  managerDigest: OciDigestSchema,
  workerDigest: OciDigestSchema,
  browserVersion: z.string().min(1).max(128),
  toolchainLockSha256: Sha256Schema,
  managerConfigSha256: Sha256Schema,
  releaseEvidenceSha256: Sha256Schema,
  releaseEvidenceMode: z.literal(MANAGED_RELEASE_EVIDENCE_MODE.CONFIG_FILE),
  createTokenKeyId: CreateTokenKeyIdSchema,
  startedAt: IsoTimeSchema,
}).strict()
export const VersionSchema = withDeepFrozenOutput(VersionBaseSchema)

export const ManagedListPageSchema = z.object({
  pageSize: z.number().int().min(1).max(100),
  nextCursor: OpaqueCursorSchema.optional(),
  snapshotCursor: OpaqueCursorSchema,
  hasMore: z.boolean(),
}).strict().superRefine((page, context) => {
  if (page.hasMore !== (page.nextCursor !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "next cursor presence must match hasMore" })
  }
})

export function managedListSchema<Output, Definition extends z.ZodTypeDef, Input>(
  itemSchema: z.ZodType<Output, Definition, Input>,
) {
  return z.object({
    apiVersion: ControlPlaneApiVersionSchema,
    items: z.array(itemSchema),
    page: ManagedListPageSchema,
  }).strict()
}

export const WorkerListSchema = withDeepFrozenOutput(managedListSchema(WorkerSchema))
export const SessionListSchema = withDeepFrozenOutput(managedListSchema(SessionSchema))
export const AdmissionListSchema = withDeepFrozenOutput(managedListSchema(AdmissionSchema))

const ManagedListQueryShape = {
  pageSize: z.number().int().min(1).max(100).default(50),
  cursor: OpaqueCursorSchema.optional(),
} as const

export const ManagedListQuerySchema = z.object(ManagedListQueryShape).strict()
export const WorkerListQuerySchema = z
  .object({ ...ManagedListQueryShape, state: z.array(WorkerStateSchema).min(1).optional() })
  .strict()
export const SessionListQuerySchema = z
  .object({ ...ManagedListQueryShape, state: z.array(SessionStateSchema).min(1).optional() })
  .strict()
export const AdmissionListQuerySchema = z
  .object({ ...ManagedListQueryShape, state: z.array(AdmissionStateSchema).min(1).optional() })
  .strict()

export type Worker = z.infer<typeof WorkerSchema>
export type Session = z.infer<typeof SessionSchema>
export type Admission = z.infer<typeof AdmissionSchema>
export type Version = z.infer<typeof VersionSchema>
export type QueueWait = z.infer<typeof MillisecondCountSchema>
export type ManagedListQuery = z.infer<typeof ManagedListQuerySchema>
export type WorkerListQuery = z.infer<typeof WorkerListQuerySchema>
export type SessionListQuery = z.infer<typeof SessionListQuerySchema>
export type AdmissionListQuery = z.infer<typeof AdmissionListQuerySchema>
