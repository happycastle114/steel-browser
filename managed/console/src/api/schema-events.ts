import { z } from "zod"

import {
  AdmissionState,
  EventType,
  ManagerMode,
  ManagerModeCause,
  SessionState,
  WorkerState,
} from "../domain/vocabulary.js"
import {
  AdmissionIdSchema,
  ApiVersionSchema,
  InstanceIdSchema,
  IsoTimeSchema,
  OpaqueCursorSchema,
  SessionIdSchema,
  WorkerIdSchema,
} from "./schema-primitives.js"

export { EventType } from "../domain/vocabulary.js"

const reasonCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/u)
const base = {
  admissionId: AdmissionIdSchema.optional(),
  apiVersion: ApiVersionSchema,
  bootId: InstanceIdSchema,
  eventId: z.string().min(1).max(128),
  instanceId: InstanceIdSchema.optional(),
  occurredAt: IsoTimeSchema,
  sequence: z.string().regex(/^[1-9][0-9]{0,19}$/u),
  sessionId: SessionIdSchema.optional(),
  workerId: WorkerIdSchema.optional(),
} as const

const statePayload = <Schema extends z.ZodTypeAny>(schema: Schema) => z.object({
  from: schema,
  reasonCode: reasonCodeSchema.optional(),
  to: schema,
}).strict()

export const ManagedEventSchema = z.discriminatedUnion("type", [
  z.object({ ...base, payload: statePayload(z.nativeEnum(WorkerState)), type: z.literal(EventType.WORKER_STATE_CHANGED) }).strict(),
  z.object({ ...base, payload: statePayload(z.nativeEnum(SessionState)), type: z.literal(EventType.SESSION_STATE_CHANGED) }).strict(),
  z.object({ ...base, payload: statePayload(z.nativeEnum(AdmissionState)), type: z.literal(EventType.ADMISSION_STATE_CHANGED) }).strict(),
  z.object({ ...base, payload: z.object({ journalState: z.string(), outcome: z.enum(["RECOVERED", "QUARANTINED"]) }).strict(), type: z.literal(EventType.CREATE_RECOVERY) }).strict(),
  z.object({ ...base, payload: z.object({ reasonCode: z.enum(["INSTANCE_CHANGED", "WORKER_RESTARTED"]) }).strict(), type: z.literal(EventType.INSTANCE_LOST) }).strict(),
  z.object({
    ...base,
    payload: z.union([
      z.object({ cause: z.nativeEnum(ManagerModeCause), deadlineAt: IsoTimeSchema, drainEnteredAt: IsoTimeSchema, from: z.literal(ManagerMode.SERVING), safeAt: IsoTimeSchema, to: z.literal(ManagerMode.DRAINING), transition: z.literal("DRAIN") }).strict(),
      z.object({ cause: z.nativeEnum(ManagerModeCause), from: z.literal(ManagerMode.DRAINING), previousSafeAt: IsoTimeSchema, resumedAt: IsoTimeSchema, to: z.literal(ManagerMode.SERVING), transition: z.literal("RESUME") }).strict(),
    ]),
    type: z.literal(EventType.MANAGER_MODE_CHANGED),
  }).strict(),
])

export const EventListSchema = z.object({
  apiVersion: ApiVersionSchema,
  hasMore: z.boolean(),
  items: z.array(ManagedEventSchema),
  nextCursor: OpaqueCursorSchema,
  snapshotCursor: OpaqueCursorSchema,
}).strict().readonly()

export type ManagedEvent = z.infer<typeof ManagedEventSchema>
export type EventList = z.infer<typeof EventListSchema>
