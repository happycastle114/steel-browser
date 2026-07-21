import { z } from "zod"

import { AdmissionState, SessionState, WorkerState } from "../domain/vocabulary.js"
import {
  AdmissionIdSchema,
  ApiVersionSchema,
  InstanceIdSchema,
  IsoTimeSchema,
  OciDigestSchema,
  OpaqueCursorSchema,
  SafeCountSchema,
  SessionIdSchema,
  Sha256Schema,
  GitShaSchema,
  WorkerIdSchema,
} from "./schema-primitives.js"

const failureCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/u)

export const WorkerSchema = z.object({
  failureCode: failureCodeSchema.optional(),
  instanceId: InstanceIdSchema,
  lastSeenAt: IsoTimeSchema,
  sessionId: SessionIdSchema.optional(),
  state: z.nativeEnum(WorkerState),
  stateChangedAt: IsoTimeSchema,
  workerId: WorkerIdSchema,
}).strict().readonly()

export const SessionSchema = z.object({
  admissionId: AdmissionIdSchema.optional(),
  createdAt: IsoTimeSchema,
  endedAt: IsoTimeSchema.optional(),
  failureCode: failureCodeSchema.optional(),
  instanceId: InstanceIdSchema.optional(),
  sessionId: SessionIdSchema,
  startedAt: IsoTimeSchema.optional(),
  state: z.nativeEnum(SessionState),
  workerId: WorkerIdSchema.optional(),
}).strict().readonly()

export const AdmissionSchema = z.object({
  admissionId: AdmissionIdSchema,
  createdAt: IsoTimeSchema,
  expiresAt: IsoTimeSchema,
  failureCode: failureCodeSchema.optional(),
  position: SafeCountSchema.optional(),
  sessionId: SessionIdSchema.optional(),
  state: z.nativeEnum(AdmissionState),
  updatedAt: IsoTimeSchema,
}).strict().readonly()

const listPageSchema = z.object({
  hasMore: z.boolean(),
  nextCursor: OpaqueCursorSchema.optional(),
  pageSize: z.number().int().min(1).max(100),
  snapshotCursor: OpaqueCursorSchema,
}).strict()

const listSchema = <Schema extends z.ZodTypeAny>(schema: Schema) => z.object({
  apiVersion: ApiVersionSchema,
  items: z.array(schema),
  page: listPageSchema,
}).strict().readonly()

export const WorkerListSchema = listSchema(WorkerSchema)
export const SessionListSchema = listSchema(SessionSchema)
export const AdmissionListSchema = listSchema(AdmissionSchema)

export const VersionSchema = z.object({
  apiVersion: ApiVersionSchema,
  browserVersion: z.string().min(1).max(128),
  createTokenKeyId: z.string().regex(/^[0-9a-f]{16}$/u),
  managedSha: GitShaSchema,
  managerDigest: OciDigestSchema,
  startedAt: IsoTimeSchema,
  toolchainLockSha256: Sha256Schema,
  upstreamSha: GitShaSchema,
  workerDigest: OciDigestSchema,
}).strict().readonly()

export type Worker = z.infer<typeof WorkerSchema>
export type Session = z.infer<typeof SessionSchema>
export type Admission = z.infer<typeof AdmissionSchema>
export type Version = z.infer<typeof VersionSchema>
export type WorkerList = z.infer<typeof WorkerListSchema>
export type SessionList = z.infer<typeof SessionListSchema>
export type AdmissionList = z.infer<typeof AdmissionListSchema>
