import { z } from "zod"

import { ManagerMode, ManagerModeCause, WorkerState } from "../domain/vocabulary.js"
import { ApiVersionSchema, ByteCountSchema, InstanceIdSchema, IsoTimeSchema, SafeCountSchema } from "./schema-primitives.js"

const blockingSchema = z.object({
  admissions: SafeCountSchema,
  inFlightActions: SafeCountSchema,
  liveSessions: SafeCountSchema,
  retainedResults: SafeCountSchema,
  webSockets: SafeCountSchema,
}).strict()

const handoverSchema = z.discriminatedUnion("mode", [
  z.object({ blocking: blockingSchema, mode: z.literal(ManagerMode.SERVING), safe: z.literal(false) }).strict(),
  z.object({
    blocking: blockingSchema,
    cause: z.nativeEnum(ManagerModeCause),
    drainEnteredAt: IsoTimeSchema,
    lastMutationAt: IsoTimeSchema,
    managerInstanceId: InstanceIdSchema,
    mode: z.literal(ManagerMode.DRAINING),
    safe: z.boolean(),
    safeAt: IsoTimeSchema,
  }).strict(),
])

export const MemoryLedgerSchema = z.object({
  limitBytes: ByteCountSchema,
  limitCount: SafeCountSchema,
  reservedBytes: ByteCountSchema,
  reservedCount: SafeCountSchema,
}).strict().readonly()

const stateCountShape = Object.fromEntries(Object.values(WorkerState).map((state) => [state.toLowerCase(), SafeCountSchema]))

export const PoolSchema = z.object({
  apiVersion: ApiVersionSchema,
  counts: z.object({
    busy: SafeCountSchema,
    byState: z.object(stateCountShape).strict(),
    physical: z.literal(2),
    reconciledIdle: SafeCountSchema,
    unavailable: SafeCountSchema,
    usableReachable: SafeCountSchema,
  }).strict(),
  generatedAt: IsoTimeSchema,
  handover: handoverSchema,
  managerInstanceId: InstanceIdSchema,
  memory: z.object({
    action: MemoryLedgerSchema,
    baseP95Bytes: ByteCountSchema,
    dynamicLimitBytes: ByteCountSchema,
    ingressBody: MemoryLedgerSchema,
    ingressConnection: MemoryLedgerSchema,
    managerLimitBytes: ByteCountSchema,
    result: MemoryLedgerSchema,
    snapshotLimitBytes: ByteCountSchema,
    tmpfsLimitBytes: ByteCountSchema,
    webSocket: MemoryLedgerSchema,
  }).strict(),
  mode: z.nativeEnum(ManagerMode),
  poolId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/u),
  queue: z.object({ depth: SafeCountSchema, max: SafeCountSchema, oldestWaitMs: SafeCountSchema }).strict(),
}).strict().readonly()

export type Pool = z.infer<typeof PoolSchema>
export type MemoryLedger = z.infer<typeof MemoryLedgerSchema>
