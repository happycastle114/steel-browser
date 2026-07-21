import { z } from "zod"

import {
  ActionIdSchema,
  IsoTimeSchema,
  ResultIdSchema,
  SessionIdSchema,
  Sha256Schema,
} from "./control-plane-primitives.js"
import { RESULT_KIND } from "./control-plane-vocabulary.js"
import { ManagedTransportConfigSchema, type ManagedTransportConfig } from "./managed-transport-config.js"
import { AdmissionSchema, SessionSchema, SessionListSchema } from "./managed-resources.js"
import {
  createPublicUrlSchemas,
  parseLiveViewUrlBinding,
  parseResultDownloadUrlId,
  parseSessionUrlBinding,
  type LiveViewUrlBinding,
  type SelectedPublicOrigin,
  type SessionUrlBinding,
} from "./public-urls.js"

export const TEXT_RESULT_FORMAT = {
  ACCESSIBILITY: "accessibility",
  TEXT: "text",
  MARKDOWN: "markdown",
} as const
export const BINARY_CONTENT_TYPE = { PNG: "image/png", JPEG: "image/jpeg" } as const

export const AdmissionResultSchema = z.object({
  kind: z.literal(RESULT_KIND.ADMISSION),
  admission: AdmissionSchema,
}).strict()
export const ActionAckSchema = z.object({
  kind: z.literal(RESULT_KIND.ACTION),
  sessionId: SessionIdSchema,
  actionId: ActionIdSchema,
  completedAt: IsoTimeSchema,
}).strict()
export const NavigationResultSchema = z.object({
  kind: z.literal(RESULT_KIND.NAVIGATION),
  sessionId: SessionIdSchema,
  url: z.string().url(),
  title: z.string().max(4_096).optional(),
  completedAt: IsoTimeSchema,
}).strict()
export const SessionListToolOutputSchema = SessionListSchema
export const SessionReleaseToolOutputSchema = SessionSchema
export const AdmissionStatusToolOutputSchema = AdmissionSchema
export const AdmissionCancelToolOutputSchema = AdmissionSchema
function boundedByteCount(maximum: number) {
  return z.number().int().safe().nonnegative().max(maximum).brand("ByteCount")
}

export function createToolResultSchemas(
  originInput: SelectedPublicOrigin,
  transportInput: ManagedTransportConfig,
) {
  const transport = ManagedTransportConfigSchema.parse(transportInput)
  const urls = createPublicUrlSchemas(originInput)
  const TextResultSchema = z.object({
    kind: z.literal(RESULT_KIND.TEXT),
    sessionId: SessionIdSchema,
    format: z.nativeEnum(TEXT_RESULT_FORMAT),
    text: z.string(),
    truncated: z.boolean(),
    byteLength: boundedByteCount(transport.httpBodyBytes),
    deliveredByteLength: boundedByteCount(transport.textBytes),
    sha256: Sha256Schema,
  }).strict().superRefine((result, context) => {
    const deliveredBytes = new TextEncoder().encode(result.text).byteLength
    const invalidTruncation = result.truncated
      ? result.deliveredByteLength >= result.byteLength
      : result.deliveredByteLength !== result.byteLength
    if (invalidTruncation || deliveredBytes !== result.deliveredByteLength) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "text byte metadata mismatch" })
    }
  })
  const SessionUrlsSchema = z.object({
    websocketUrl: urls.SessionWebSocketUrlSchema,
    debugUrl: urls.SessionDebugUrlSchema.optional(),
    viewerUrl: urls.ViewerUrlSchema.optional(),
  }).strict().superRefine((value, context) => {
    try {
      parseSessionUrlBinding(value)
    } catch {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "session URLs must bind the same Host and session" })
    }
  })
  const SessionResultSchema = z.object({
    kind: z.literal(RESULT_KIND.SESSION),
    session: SessionSchema,
    urls: SessionUrlsSchema,
  }).strict().superRefine((result, context) => {
    let binding: SessionUrlBinding
    try {
      binding = parseSessionUrlBinding(result.urls)
    } catch {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "invalid public session URL binding" })
      return
    }
    if (binding.sessionId !== result.session.sessionId) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "session URL identity mismatch" })
    }
  })
  const BinaryCompletionSchema = z.object({
    kind: z.literal(RESULT_KIND.BINARY),
    sessionId: SessionIdSchema,
    contentType: z.nativeEnum(BINARY_CONTENT_TYPE),
    byteLength: boundedByteCount(Math.min(transport.binaryBytes, transport.resultBytes)),
    sha256: Sha256Schema,
  }).strict()
  const BinaryResultSchema = BinaryCompletionSchema.extend({
    resultId: ResultIdSchema,
    expiresAt: IsoTimeSchema,
    downloadUrl: urls.ResultDownloadUrlSchema,
  }).strict().superRefine((result, context) => {
    if (parseResultDownloadUrlId(result.downloadUrl) !== result.resultId) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "result download URL ID mismatch" })
    }
  })
  const LiveViewResultSchema = z.object({
    kind: z.literal(RESULT_KIND.LIVE_VIEW),
    sessionId: SessionIdSchema,
    viewerUrl: urls.ViewerUrlSchema,
    castWebSocketUrl: urls.CastWebSocketUrlSchema,
  }).strict().superRefine((result, context) => {
    let binding: LiveViewUrlBinding
    try {
      binding = parseLiveViewUrlBinding(result.viewerUrl, result.castWebSocketUrl)
    } catch {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "live-view URLs must bind the same Host and session" })
      return
    }
    if (binding.sessionId !== result.sessionId) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "live-view URL session mismatch" })
    }
  })
  const ManagedToolResultSchema = z.union([
    SessionResultSchema,
    AdmissionResultSchema,
    ActionAckSchema,
    TextResultSchema,
    BinaryResultSchema,
    NavigationResultSchema,
    LiveViewResultSchema,
    SessionListSchema,
    SessionSchema,
    AdmissionSchema,
  ])
  return Object.freeze({
    SessionUrlsSchema,
    SessionResultSchema,
    TextResultSchema,
    BinaryCompletionSchema,
    BinaryResultSchema,
    LiveViewResultSchema,
    ManagedToolResultSchema,
    SessionCreateToolOutputSchema: z.union([SessionResultSchema, AdmissionResultSchema]),
    SessionGetToolOutputSchema: SessionResultSchema,
    SnapshotToolOutputSchema: TextResultSchema.refine(
      (result) => result.format === TEXT_RESULT_FORMAT.ACCESSIBILITY,
    ),
    ScrapeToolOutputSchema: TextResultSchema.refine(
      (result) => result.format !== TEXT_RESULT_FORMAT.ACCESSIBILITY,
    ),
  })
}

type ToolResultSchemas = ReturnType<typeof createToolResultSchemas>
export type BinaryCompletion = z.output<ToolResultSchemas["BinaryCompletionSchema"]>
export type BinaryResult = z.output<ToolResultSchemas["BinaryResultSchema"]>
export type LiveViewResult = z.output<ToolResultSchemas["LiveViewResultSchema"]>
export type ManagedToolResult = z.output<ToolResultSchemas["ManagedToolResultSchema"]>
export type SessionResult = z.output<ToolResultSchemas["SessionResultSchema"]>
export type TextResult = z.output<ToolResultSchemas["TextResultSchema"]>
