import { z } from "zod"

import {
  CreateTokenSchema,
  IsoTimeSchema,
  SessionIdSchema,
  Sha256Schema,
} from "./control-plane-primitives.js"
import {
  CREATE_JOURNAL_STATE,
  CREATE_REPLAY_TEMPLATE_KIND,
} from "./control-plane-vocabulary.js"

export const PUBLIC_URL_KIND = {
  WEBSOCKET: "WEBSOCKET",
  DEBUG: "DEBUG",
  DEVTOOLS: "DEVTOOLS",
  VIEWER: "VIEWER",
} as const

export const PublicUrlPlaceholderSchema = z.object({
  kind: z.literal(CREATE_REPLAY_TEMPLATE_KIND.PUBLIC_URL),
  urlKind: z.nativeEnum(PUBLIC_URL_KIND),
  sessionId: SessionIdSchema,
}).strict()

export type CreateBodyTemplate = string | number | boolean | null | z.infer<typeof PublicUrlPlaceholderSchema> | readonly CreateBodyTemplate[] | Readonly<{ readonly [key: string]: CreateBodyTemplate }>
export const CreateBodyTemplateSchema: z.ZodType<CreateBodyTemplate> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  PublicUrlPlaceholderSchema,
  z.array(CreateBodyTemplateSchema),
  z.record(CreateBodyTemplateSchema),
]))

export const CreateReplaySchema = z.object({
  status: z.number().int().min(100).max(599),
  headers: z.object({
    contentType: z.string().min(1).max(256).optional(),
    locationTemplate: PublicUrlPlaceholderSchema.optional(),
    retryAfterSeconds: z.number().int().positive().safe().optional(),
  }).strict(),
  bodyTemplate: CreateBodyTemplateSchema,
}).strict()
export type CreateReplay = z.infer<typeof CreateReplaySchema>

const recordFields = {
  token: CreateTokenSchema,
  ownerSha256: Sha256Schema,
  requestSha256: Sha256Schema,
  updatedAt: IsoTimeSchema,
  expiresAt: IsoTimeSchema,
}
const PendingReplayRecordSchema = z.object({
  ...recordFields,
  state: z.union([
    z.literal(CREATE_JOURNAL_STATE.ACCEPTED),
    z.literal(CREATE_JOURNAL_STATE.UPSTREAM_PENDING),
    z.literal(CREATE_JOURNAL_STATE.UNCERTAIN),
  ]),
}).strict()
const LiveReplayRecordSchema = z.object({
  ...recordFields,
  state: z.literal(CREATE_JOURNAL_STATE.LIVE),
  upstreamSessionId: SessionIdSchema,
  replay: CreateReplaySchema,
}).strict()
const ReleasedReplayRecordSchema = z.object({
  ...recordFields,
  state: z.literal(CREATE_JOURNAL_STATE.RELEASED_TERMINAL),
  upstreamSessionId: SessionIdSchema,
  replay: CreateReplaySchema,
}).strict()
const FailedReplayRecordSchema = z.object({
  ...recordFields,
  state: z.literal(CREATE_JOURNAL_STATE.FAILED_TERMINAL),
  upstreamSessionId: SessionIdSchema.optional(),
  replay: CreateReplaySchema,
}).strict()

export const CreateReplayRecordSchema = z.union([
  PendingReplayRecordSchema,
  LiveReplayRecordSchema,
  ReleasedReplayRecordSchema,
  FailedReplayRecordSchema,
])
export type CreateReplayRecord = z.infer<typeof CreateReplayRecordSchema>
