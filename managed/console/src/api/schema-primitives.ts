import { z } from "zod"

export const CONTROL_PLANE_API_VERSION = "2026-07-01" as const
export const MCP_PROTOCOL_VERSION = "2025-11-25" as const

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

export const ApiVersionSchema = z.literal(CONTROL_PLANE_API_VERSION)
export const UuidSchema = z.string().regex(uuidPattern).brand("Uuid")
export const UuidV4Schema = z.string().regex(uuidV4Pattern).brand("UuidV4")
export const SessionIdSchema = UuidSchema.brand("SessionId")
export const AdmissionIdSchema = UuidSchema.brand("AdmissionId")
export const WorkerIdSchema = z.string().regex(/^worker-(?:0[0-9]|[12][0-9]|3[01])$/u).brand("WorkerId")
export const InstanceIdSchema = UuidV4Schema.brand("InstanceId")
export const ResultIdSchema = UuidV4Schema.brand("ResultId")
export const CreateIdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/u).brand("CreateIdempotencyKey")
export const IsoTimeSchema = z.string().datetime({ offset: false, precision: 3 }).brand("IsoTime")
export const SafeCountSchema = z.number().int().safe().nonnegative().brand("SafeCount")
export const ByteCountSchema = z.number().int().safe().nonnegative().brand("ByteCount")
export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u).brand("Sha256")
export const GitShaSchema = z.string().regex(/^[0-9a-f]{40}$/u).brand("GitSha")
export const OciDigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u).brand("OciDigest")
export const OpaqueCursorSchema = z.string().regex(/^[A-Za-z0-9_-]+$/u).min(2).brand("OpaqueCursor")

export type SessionId = z.infer<typeof SessionIdSchema>
export type AdmissionId = z.infer<typeof AdmissionIdSchema>
export type WorkerId = z.infer<typeof WorkerIdSchema>
export type IsoTime = z.infer<typeof IsoTimeSchema>
export type CreateIdempotencyKey = z.infer<typeof CreateIdempotencyKeySchema>
