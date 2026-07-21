import { z } from "zod"

import { ControlPlaneApiVersionSchema } from "./control-plane-contract.js"
import {
  AdmissionIdSchema,
  BootIdSchema,
  EventSequenceSchema,
  InstanceIdSchema,
  IsoTimeSchema,
  OpaqueCursorSchema,
  SessionIdSchema,
  WorkerIdSchema,
} from "./control-plane-primitives.js"
import {
  ADMISSION_STATE,
  EVENT_TYPE,
  MANAGER_MODE,
  MANAGER_MODE_CAUSE,
  MANAGER_MODE_TRANSITION,
} from "./control-plane-vocabulary.js"
import {
  AdmissionStateSchema,
  CreateJournalStateSchema,
  CreateRecoveryOutcomeSchema,
  InstanceLostReasonSchema,
  ManagerModeCauseSchema,
  SessionStateSchema,
  WorkerStateSchema,
} from "./control-plane-vocabulary-schemas.js"
import {
  canAdmissionTransition,
  canSessionTransition,
  canWorkerTransition,
} from "./control-plane-transitions.js"
import { withDeepFrozenOutput } from "./deep-readonly.js"

const ReasonCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/u)
const baseFields = {
  apiVersion: ControlPlaneApiVersionSchema,
  eventId: z.string().min(1).max(128),
  bootId: BootIdSchema,
  sequence: EventSequenceSchema,
  occurredAt: IsoTimeSchema,
}

const WorkerStatePayloadSchema = z.object({
  from: WorkerStateSchema,
  to: WorkerStateSchema,
  reasonCode: ReasonCodeSchema.optional(),
}).strict().superRefine((payload, context) => {
  if (!canWorkerTransition(payload.from, payload.to)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "illegal worker transition" })
  }
})

const SessionStatePayloadSchema = z.object({
  from: SessionStateSchema,
  to: SessionStateSchema,
  reasonCode: ReasonCodeSchema.optional(),
}).strict().superRefine((payload, context) => {
  if (!canSessionTransition(payload.from, payload.to)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "illegal session transition" })
  }
})

const AdmissionStatePayloadSchema = z.object({
  from: AdmissionStateSchema,
  to: AdmissionStateSchema,
  reasonCode: ReasonCodeSchema.optional(),
}).strict().superRefine((payload, context) => {
  if (!canAdmissionTransition(payload.from, payload.to)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "illegal admission transition" })
  }
})

const WorkerStateEventSchema = z.object({
  ...baseFields,
  type: z.literal(EVENT_TYPE.WORKER_STATE_CHANGED),
  workerId: WorkerIdSchema,
  instanceId: InstanceIdSchema,
  payload: WorkerStatePayloadSchema,
}).strict()
const SessionStateEventSchema = z.object({
  ...baseFields,
  type: z.literal(EVENT_TYPE.SESSION_STATE_CHANGED),
  sessionId: SessionIdSchema,
  payload: SessionStatePayloadSchema,
}).strict()
const AdmissionStateEventSchema = z.object({
  ...baseFields,
  type: z.literal(EVENT_TYPE.ADMISSION_STATE_CHANGED),
  admissionId: AdmissionIdSchema,
  payload: AdmissionStatePayloadSchema,
}).strict()
const CreateRecoveryEventSchema = z.object({
  ...baseFields,
  type: z.literal(EVENT_TYPE.CREATE_RECOVERY),
  sessionId: SessionIdSchema,
  payload: z.object({ journalState: CreateJournalStateSchema, outcome: CreateRecoveryOutcomeSchema }).strict(),
}).strict()
const InstanceLostEventSchema = z.object({
  ...baseFields,
  type: z.literal(EVENT_TYPE.INSTANCE_LOST),
  workerId: WorkerIdSchema,
  instanceId: InstanceIdSchema,
  payload: z.object({ reasonCode: InstanceLostReasonSchema }).strict(),
}).strict()
const ManagerDrainEventSchema = z.object({
  ...baseFields,
  type: z.literal(EVENT_TYPE.MANAGER_MODE_CHANGED),
  payload: z.object({
    transition: z.literal(MANAGER_MODE_TRANSITION.DRAIN),
    from: z.literal(MANAGER_MODE.SERVING),
    to: z.literal(MANAGER_MODE.DRAINING),
    cause: ManagerModeCauseSchema,
    deadlineAt: IsoTimeSchema,
    drainEnteredAt: IsoTimeSchema,
    safeAt: IsoTimeSchema,
  }).strict(),
}).strict()
const ManagerResumeEventSchema = z.object({
  ...baseFields,
  type: z.literal(EVENT_TYPE.MANAGER_MODE_CHANGED),
  payload: z.object({
    transition: z.literal(MANAGER_MODE_TRANSITION.RESUME),
    from: z.literal(MANAGER_MODE.DRAINING),
    to: z.literal(MANAGER_MODE.SERVING),
    cause: z.union([
      z.literal(MANAGER_MODE_CAUSE.CUTOVER),
      z.literal(MANAGER_MODE_CAUSE.ROLLBACK),
      z.literal(MANAGER_MODE_CAUSE.REPROMOTION),
      z.literal(MANAGER_MODE_CAUSE.RECOVERY),
    ]),
    previousSafeAt: IsoTimeSchema,
    resumedAt: IsoTimeSchema,
  }).strict(),
}).strict()

const ManagedEventBaseSchema = z.union([
  WorkerStateEventSchema,
  SessionStateEventSchema,
  AdmissionStateEventSchema,
  CreateRecoveryEventSchema,
  InstanceLostEventSchema,
  ManagerDrainEventSchema,
  ManagerResumeEventSchema,
]).superRefine((event, context) => {
  if (event.eventId !== `${event.bootId}:${event.sequence}`) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "event ID must bind boot and sequence" })
  }
})

export const ManagedEventSchema = withDeepFrozenOutput(ManagedEventBaseSchema)
export const EventListSchema = withDeepFrozenOutput(z.object({
  apiVersion: ControlPlaneApiVersionSchema,
  items: z.array(ManagedEventSchema),
  nextCursor: OpaqueCursorSchema,
  snapshotCursor: OpaqueCursorSchema,
  hasMore: z.boolean(),
}).strict())
export const EventQuerySchema = z.object({
  pageSize: z.number().int().min(1).max(100).default(50),
  cursor: OpaqueCursorSchema.optional(),
  snapshotCursor: OpaqueCursorSchema.optional(),
}).strict()

export type ManagedEvent = z.infer<typeof ManagedEventSchema>
export const TERMINAL_ADMISSION_STATES = [
  ADMISSION_STATE.ADMITTED,
  ADMISSION_STATE.CANCELLED,
  ADMISSION_STATE.EXPIRED,
  ADMISSION_STATE.FAILED,
] as const
