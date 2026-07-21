import { z } from "zod"

import { ControlPlaneApiVersionSchema } from "./control-plane-contract.js"
import { ResultIdSchema, UuidSchema } from "./control-plane-primitives.js"
import {
  createPublicUrlSchemas,
  parseResultDownloadUrlId,
  type SelectedPublicOrigin,
} from "./public-urls.js"

export const HTTP_SUCCESS_STATUS = { OK: 200, ACCEPTED: 202 } as const
export const HTTP_RESPONSE_HEADER = { LOCATION: "Location", RETRY_AFTER: "Retry-After" } as const
export const AI_ASYNC_OUTCOME_STATE = {
  ACCEPTED: "ACCEPTED",
  PENDING: "PENDING",
  COMPLETED: "COMPLETED",
} as const
export const RetryAfterSecondsSchema = z.number().int().positive().safe()
export const RetryAfterHeaderValueSchema = z.string().regex(/^[1-9][0-9]*$/u)

export type HttpSuccessStatus = (typeof HTTP_SUCCESS_STATUS)[keyof typeof HTTP_SUCCESS_STATUS]
export type HttpResponseHeader = (typeof HTTP_RESPONSE_HEADER)[keyof typeof HTTP_RESPONSE_HEADER]
export type AiAsyncOutcomeState = (typeof AI_ASYNC_OUTCOME_STATE)[keyof typeof AI_ASYNC_OUTCOME_STATE]

const RetryAfterHeadersSchema = z.object({
  [HTTP_RESPONSE_HEADER.RETRY_AFTER]: RetryAfterHeaderValueSchema,
}).strict()
export const AiRequestIdSchema = UuidSchema.brand("AiRequestId")
export const AiCorrelationIdSchema = UuidSchema.brand("AiCorrelationId")
const AiOutcomeIdentityShape = {
  apiVersion: ControlPlaneApiVersionSchema,
  resultId: ResultIdSchema,
  requestId: AiRequestIdSchema,
  correlationId: AiCorrelationIdSchema,
} as const
export const AiActionAcceptedBodySchema = z.object({
  ...AiOutcomeIdentityShape,
  state: z.literal(AI_ASYNC_OUTCOME_STATE.ACCEPTED),
  retryAfterSeconds: RetryAfterSecondsSchema,
}).strict()
export const AiResultPendingBodySchema = z.object({
  ...AiOutcomeIdentityShape,
  state: z.literal(AI_ASYNC_OUTCOME_STATE.PENDING),
  retryAfterSeconds: RetryAfterSecondsSchema,
}).strict()

export function createAiActionAcceptedOutcomeSchema(originInput: SelectedPublicOrigin) {
  const resultUrlSchema = createPublicUrlSchemas(originInput).ResultDownloadUrlSchema
  return z.object({
    status: z.literal(HTTP_SUCCESS_STATUS.ACCEPTED),
    headers: z.object({
      [HTTP_RESPONSE_HEADER.LOCATION]: resultUrlSchema,
      [HTTP_RESPONSE_HEADER.RETRY_AFTER]: RetryAfterHeaderValueSchema,
    }).strict(),
    body: AiActionAcceptedBodySchema,
  }).strict().superRefine((outcome, context) => {
    if (parseResultDownloadUrlId(outcome.headers[HTTP_RESPONSE_HEADER.LOCATION]) !== outcome.body.resultId) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Location and body resultId must match" })
    }
    if (outcome.headers[HTTP_RESPONSE_HEADER.RETRY_AFTER] !== String(outcome.body.retryAfterSeconds)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Retry-After and body clock must match" })
    }
  })
}
export const AiResultPendingOutcomeSchema = z.object({
  status: z.literal(HTTP_SUCCESS_STATUS.ACCEPTED),
  headers: RetryAfterHeadersSchema,
  body: AiResultPendingBodySchema,
}).strict().superRefine((outcome, context) => {
  if (outcome.headers[HTTP_RESPONSE_HEADER.RETRY_AFTER] !== String(outcome.body.retryAfterSeconds)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Retry-After and body clock must match" })
  }
})
export function createAiResultCompletedBodySchema<Output, Definition extends z.ZodTypeDef, Input>(
  resultSchema: z.ZodType<Output, Definition, Input>,
) {
  return z.object({
    ...AiOutcomeIdentityShape,
    state: z.literal(AI_ASYNC_OUTCOME_STATE.COMPLETED),
    result: resultSchema,
  }).strict()
}
export function createAiResultBodySchema<Output, Definition extends z.ZodTypeDef, Input>(
  resultSchema: z.ZodType<Output, Definition, Input>,
) {
  return z.discriminatedUnion("state", [AiResultPendingBodySchema, createAiResultCompletedBodySchema(resultSchema)])
}
export function createAiResultCompletedOutcomeSchema<Output, Definition extends z.ZodTypeDef, Input>(
  resultSchema: z.ZodType<Output, Definition, Input>,
) {
  return z.object({
    status: z.literal(HTTP_SUCCESS_STATUS.OK),
    headers: z.object({}).strict(),
    body: createAiResultCompletedBodySchema(resultSchema),
  }).strict()
}
export function createAiResultOutcomeSchema<Output, Definition extends z.ZodTypeDef, Input>(
  resultSchema: z.ZodType<Output, Definition, Input>,
) {
  return z.union([AiResultPendingOutcomeSchema, createAiResultCompletedOutcomeSchema(resultSchema)])
}

export type AiActionAcceptedOutcome = z.infer<ReturnType<typeof createAiActionAcceptedOutcomeSchema>>
export type AiActionAcceptedBody = z.infer<typeof AiActionAcceptedBodySchema>
export type AiResultPendingBody = z.infer<typeof AiResultPendingBodySchema>
export type AiResultPendingOutcome = z.infer<typeof AiResultPendingOutcomeSchema>
export type AiRequestId = z.infer<typeof AiRequestIdSchema>
export type AiCorrelationId = z.infer<typeof AiCorrelationIdSchema>
export type AiResultCompletedBody<Result> = Readonly<{
  readonly apiVersion: z.infer<typeof ControlPlaneApiVersionSchema>
  readonly resultId: z.infer<typeof ResultIdSchema>
  readonly state: typeof AI_ASYNC_OUTCOME_STATE.COMPLETED
  readonly result: Result
  readonly requestId: AiRequestId
  readonly correlationId: AiCorrelationId
}>
export type AiResultCompletedOutcome<Result> = Readonly<{
  readonly status: typeof HTTP_SUCCESS_STATUS.OK
  readonly headers: Readonly<Record<string, never>>
  readonly body: AiResultCompletedBody<Result>
}>
export type AiResultOutcome<Result> = AiResultPendingOutcome | AiResultCompletedOutcome<Result>
