import { z } from "zod"

import {
  ActionKind,
  BrowserKey,
  ResultKind,
  ScrapeFormat,
  ScreenshotFormat,
  ToolMutability,
  ToolSessionRequirement,
} from "../domain/vocabulary.js"
import {
  ApiVersionSchema,
  ByteCountSchema,
  IsoTimeSchema,
  MCP_PROTOCOL_VERSION,
  ResultIdSchema,
  SessionIdSchema,
  Sha256Schema,
  UuidV4Schema,
} from "./schema-primitives.js"
import { AdmissionSchema, SessionSchema } from "./schema-resources.js"

export { ResultKind, ToolMutability, ToolSessionRequirement } from "../domain/vocabulary.js"

const toolNameSchema = z.string().regex(/^steel\.[a-z_]+\.[a-z_]+$/u)
const descriptorSchema = z.object({
  inputSchemaSha256: Sha256Schema,
  mutability: z.nativeEnum(ToolMutability),
  name: toolNameSchema,
  outputSchemaSha256: Sha256Schema,
  sessionRequirement: z.nativeEnum(ToolSessionRequirement),
  version: z.string().regex(/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u),
}).strict()

const capabilitiesBaseSchema = z.object({
  apiVersion: ApiVersionSchema,
  limits: z.object({
    actionCount: z.number().nonnegative(),
    actionTimeoutMs: z.number().nonnegative(),
    binaryBytes: ByteCountSchema,
    httpBodyBytes: ByteCountSchema,
    httpBodyCount: z.number().nonnegative(),
    httpBodyReservedBytes: ByteCountSchema,
    httpConnectionCount: z.number().nonnegative(),
    httpConnectionReservedBytes: ByteCountSchema,
    httpHeaderBytes: ByteCountSchema,
    resultBytes: ByteCountSchema,
    resultCount: z.number().nonnegative(),
    textBytes: ByteCountSchema,
    webSocketCount: z.number().nonnegative(),
    webSocketReservedBytes: ByteCountSchema,
  }).strict(),
  mcp: z.object({ endpoint: z.literal("/mcp"), protocolVersion: z.literal(MCP_PROTOCOL_VERSION), stateless: z.literal(true) }).strict(),
  service: z.object({ name: z.literal("happycastle-steel-managed"), version: z.string() }).strict(),
  tools: z.array(descriptorSchema),
}).strict()

export const CapabilitiesSchema = capabilitiesBaseSchema.readonly()

export const ToolsResponseSchema = capabilitiesBaseSchema.extend({
  tools: z.array(descriptorSchema.extend({ inputSchema: z.record(z.string(), z.unknown()), outputSchema: z.record(z.string(), z.unknown()) }).strict()),
}).strict().readonly()

const actionBase = {} as const
export const BrowserActionInputSchema = z.discriminatedUnion("kind", [
  z.object({ ...actionBase, kind: z.literal(ActionKind.NAVIGATE), sessionId: SessionIdSchema, url: z.string().url().max(2_048) }).strict(),
  z.object({ ...actionBase, kind: z.literal(ActionKind.SNAPSHOT), sessionId: SessionIdSchema }).strict(),
  z.object({ ...actionBase, format: z.nativeEnum(ScreenshotFormat).optional(), fullPage: z.boolean().optional(), kind: z.literal(ActionKind.SCREENSHOT), sessionId: SessionIdSchema }).strict(),
  z.object({ ...actionBase, format: z.nativeEnum(ScrapeFormat), kind: z.literal(ActionKind.SCRAPE), sessionId: SessionIdSchema }).strict(),
  z.object({ ...actionBase, kind: z.literal(ActionKind.CLICK), selector: z.string().min(1).max(1_024), sessionId: SessionIdSchema }).strict(),
  z.object({ ...actionBase, clear: z.boolean().optional(), kind: z.literal(ActionKind.TYPE), selector: z.string().min(1).max(1_024), sessionId: SessionIdSchema, text: z.string().max(65_536) }).strict(),
  z.object({ ...actionBase, key: z.nativeEnum(BrowserKey), kind: z.literal(ActionKind.KEY), sessionId: SessionIdSchema }).strict(),
])

export const ActionResultSchema = z.discriminatedUnion("kind", [
  z.object({ actionId: UuidV4Schema, completedAt: IsoTimeSchema, kind: z.literal(ResultKind.ACTION), sessionId: SessionIdSchema }).strict(),
  z.object({ completedAt: IsoTimeSchema, kind: z.literal(ResultKind.NAVIGATION), sessionId: SessionIdSchema, title: z.string().max(4_096).optional(), url: z.string().url() }).strict(),
  z.object({ byteLength: ByteCountSchema, deliveredByteLength: ByteCountSchema, format: z.enum(["accessibility", "markdown", "text"]), kind: z.literal(ResultKind.TEXT), sessionId: SessionIdSchema, sha256: Sha256Schema, text: z.string(), truncated: z.boolean() }).strict(),
  z.object({ byteLength: ByteCountSchema, contentType: z.enum(["image/jpeg", "image/png"]), downloadUrl: z.string().url(), expiresAt: IsoTimeSchema, kind: z.literal(ResultKind.BINARY), resultId: ResultIdSchema, sessionId: SessionIdSchema, sha256: Sha256Schema }).strict(),
])

export const LiveViewResultSchema = z.object({
  castWebSocketUrl: z.string().url(),
  kind: z.literal(ResultKind.LIVE_VIEW),
  sessionId: SessionIdSchema,
  viewerUrl: z.string().url(),
}).strict().readonly()

export const SessionCreateResultSchema = z.union([
  z.object({ kind: z.literal(ResultKind.SESSION), session: SessionSchema, urls: z.object({ debugUrl: z.string().url().optional(), viewerUrl: z.string().url().optional(), websocketUrl: z.string().url() }).strict() }).strict(),
  z.object({ admission: AdmissionSchema, kind: z.literal(ResultKind.ADMISSION) }).strict(),
]).readonly()

export type Capabilities = z.infer<typeof CapabilitiesSchema>
export type ToolsResponse = z.infer<typeof ToolsResponseSchema>
export type BrowserActionInput = z.infer<typeof BrowserActionInputSchema>
export type ActionResult = z.infer<typeof ActionResultSchema>
export type LiveViewResult = z.infer<typeof LiveViewResultSchema>
export type SessionCreateResult = z.infer<typeof SessionCreateResultSchema>
