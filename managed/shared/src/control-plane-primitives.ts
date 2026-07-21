import { z } from "zod"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const UINT64_MAX = 18_446_744_073_709_551_615n
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u

export const UuidSchema = z.string().regex(UUID_PATTERN).brand("Uuid")
export const UuidV4Schema = z.string().regex(UUID_V4_PATTERN).brand("UuidV4")
export const PoolIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/u).brand("PoolId")
export const WorkerIdSchema = z.string().regex(/^worker-(?:0[0-9]|[12][0-9]|3[01])$/u).brand("WorkerId")
export const InstanceIdSchema = UuidV4Schema.brand("InstanceId")
export const ManagerInstanceIdSchema = UuidV4Schema.brand("ManagerInstanceId")
export const AllocationIdSchema = UuidSchema.brand("AllocationId")
export const SessionIdSchema = UuidSchema.brand("SessionId")
export const AdmissionIdSchema = UuidSchema.brand("AdmissionId")
export const ResultIdSchema = UuidV4Schema.brand("ResultId")
export const ActionIdSchema = UuidV4Schema.brand("ActionId")
export const BootIdSchema = UuidV4Schema.brand("BootId")
export const SnapshotIdSchema = UuidV4Schema.brand("SnapshotId")
export const CreateIdempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9._:-]{8,128}$/u)
  .brand("CreateIdempotencyKey")
export const KeyedCreateTokenSchema = z.string().regex(/^h1_[0-9a-f]{64}$/u).brand("KeyedCreateToken")
export const RandomCreateTokenSchema = z
  .string()
  .regex(/^r1_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
  .brand("RandomCreateToken")
export const CreateTokenSchema = z.union([KeyedCreateTokenSchema, RandomCreateTokenSchema]).brand("CreateToken")
export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u).brand("Sha256")
export const GitCommitShaSchema = z.string().regex(/^[0-9a-f]{40}$/u).brand("GitCommitSha")
export const OciDigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u).brand("OciDigest")
export const CreateTokenKeyIdSchema = z.string().regex(/^[0-9a-f]{16}$/u).brand("CreateTokenKeyId")
export const IsoTimeSchema = z.string().datetime({ offset: false, precision: 3 }).brand("IsoTime")
export const SafeCountSchema = z.number().int().safe().nonnegative().brand("SafeCount")
export const ByteCountSchema = z.number().int().safe().nonnegative().brand("ByteCount")
export const MillisecondCountSchema = z.number().int().safe().nonnegative().brand("MillisecondCount")
export const PrincipalIdSchema = z.string().min(1).max(512).refine((value) => !CONTROL_CHARACTERS.test(value)).brand("PrincipalId")

function canonicalUint64(value: string, allowZero: boolean): boolean {
  const pattern = allowZero ? /^(?:0|[1-9][0-9]{0,19})$/u : /^[1-9][0-9]{0,19}$/u
  return pattern.test(value) && BigInt(value) <= UINT64_MAX
}

export const EventSequenceSchema = z.string().refine((value) => canonicalUint64(value, false)).brand("EventSequence")
export const CanonicalCursorSequenceSchema = z
  .string()
  .refine((value) => canonicalUint64(value, true))
  .brand("CanonicalCursorSequence")
export const OpaqueCursorSchema = z.string().regex(/^[A-Za-z0-9_-]+$/u).min(2).brand("OpaqueCursor")

export type Uuid = z.infer<typeof UuidSchema>
export type UuidV4 = z.infer<typeof UuidV4Schema>
export type PoolId = z.infer<typeof PoolIdSchema>
export type WorkerId = z.infer<typeof WorkerIdSchema>
export type InstanceId = z.infer<typeof InstanceIdSchema>
export type ManagerInstanceId = z.infer<typeof ManagerInstanceIdSchema>
export type AllocationId = z.infer<typeof AllocationIdSchema>
export type SessionId = z.infer<typeof SessionIdSchema>
export type AdmissionId = z.infer<typeof AdmissionIdSchema>
export type ResultId = z.infer<typeof ResultIdSchema>
export type ActionId = z.infer<typeof ActionIdSchema>
export type BootId = z.infer<typeof BootIdSchema>
export type SnapshotId = z.infer<typeof SnapshotIdSchema>
export type CreateIdempotencyKey = z.infer<typeof CreateIdempotencyKeySchema>
export type KeyedCreateToken = z.infer<typeof KeyedCreateTokenSchema>
export type RandomCreateToken = z.infer<typeof RandomCreateTokenSchema>
export type CreateToken = z.infer<typeof CreateTokenSchema>
export type Sha256 = z.infer<typeof Sha256Schema>
export type GitCommitSha = z.infer<typeof GitCommitShaSchema>
export type OciDigest = z.infer<typeof OciDigestSchema>
export type CreateTokenKeyId = z.infer<typeof CreateTokenKeyIdSchema>
export type IsoTime = z.infer<typeof IsoTimeSchema>
export type SafeCount = z.infer<typeof SafeCountSchema>
export type ByteCount = z.infer<typeof ByteCountSchema>
export type MillisecondCount = z.infer<typeof MillisecondCountSchema>
export type PrincipalId = z.infer<typeof PrincipalIdSchema>
export type EventSequence = z.infer<typeof EventSequenceSchema>
export type CanonicalCursorSequence = z.infer<typeof CanonicalCursorSequenceSchema>
export type OpaqueCursor = z.infer<typeof OpaqueCursorSchema>

export function parseSequenceBigInt(sequence: EventSequence | CanonicalCursorSequence): bigint {
  return BigInt(sequence)
}
