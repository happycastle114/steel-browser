import { z } from "zod"

import {
  CreateIdempotencyKeySchema,
  IsoTimeSchema,
  ManagerInstanceIdSchema,
} from "./control-plane-primitives.js"
import { MANAGER_MODE_CAUSE } from "./control-plane-vocabulary.js"

export const MANAGED_ADMISSION_OPERATION = {
  SESSION_CREATE: "SESSION_CREATE",
} as const

const OperatorHandoverReasonSchema = z.enum([
  MANAGER_MODE_CAUSE.CUTOVER,
  MANAGER_MODE_CAUSE.ROLLBACK,
  MANAGER_MODE_CAUSE.REPROMOTION,
  MANAGER_MODE_CAUSE.RECOVERY,
])

export const ManagedAdmissionCreateRequestSchema = z
  .object({
    idempotencyKey: CreateIdempotencyKeySchema,
    operation: z.literal(MANAGED_ADMISSION_OPERATION.SESSION_CREATE),
  })
  .strict()

export const EmptyManagedMutationBodySchema = z.object({}).strict()

export const PoolDrainRequestSchema = z
  .object({
    idempotencyKey: CreateIdempotencyKeySchema,
    expectedManagerInstanceId: ManagerInstanceIdSchema,
    deadlineAt: IsoTimeSchema,
    reason: OperatorHandoverReasonSchema,
  })
  .strict()

export const PoolResumeRequestSchema = z
  .object({
    idempotencyKey: CreateIdempotencyKeySchema,
    expectedManagerInstanceId: ManagerInstanceIdSchema,
    expectedSafeAt: IsoTimeSchema,
    reason: OperatorHandoverReasonSchema,
  })
  .strict()

export type ManagedAdmissionCreateRequest = z.infer<typeof ManagedAdmissionCreateRequestSchema>
export type EmptyManagedMutationBody = z.infer<typeof EmptyManagedMutationBodySchema>
export type PoolDrainRequest = z.infer<typeof PoolDrainRequestSchema>
export type PoolResumeRequest = z.infer<typeof PoolResumeRequestSchema>
