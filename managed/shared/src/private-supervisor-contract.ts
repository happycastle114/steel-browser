import { z } from "zod"

import {
  CreateTokenSchema, type CreateToken,
  GitCommitShaSchema,
  InstanceIdSchema,
  ManagerInstanceIdSchema,
  PoolIdSchema,
  Sha256Schema,
  WorkerIdSchema,
} from "./control-plane-primitives.js"
import { CREATE_JOURNAL_STATE, type CreateJournalState } from "./control-plane-vocabulary.js"
import {
  CreateReplayRecordSchema,
  type CreateReplayRecord,
} from "./create-replay-contract.js"

export { CreateTokenSchema } from "./control-plane-primitives.js"
export { CREATE_JOURNAL_STATE } from "./control-plane-vocabulary.js"
export { CreateReplayRecordSchema, PUBLIC_URL_KIND } from "./create-replay-contract.js"

export const PRIVATE_SUPERVISOR_METHOD = { GET: "GET" } as const
export const PRIVATE_SUPERVISOR_ROUTE_ID = {
  META: "META",
  CREATES_ACTIVE: "CREATES_ACTIVE",
  CREATES_TOKEN: "CREATES_TOKEN",
} as const
export const PRIVATE_SUPERVISOR_ROUTE = {
  META: "/v1/managed-worker/meta",
  CREATES_ACTIVE: "/v1/managed-worker/creates?scope=active",
  CREATES_TOKEN: "/v1/managed-worker/creates/:token",
} as const
export const PRIVATE_SUPERVISOR_STATUS = {
  OK: 200,
  PENDING: 202,
  NOT_FOUND: 404,
  UNAVAILABLE: 503,
} as const
export const PRIVATE_SUPERVISOR_RESPONSE_KIND = {
  META: "META",
  CREATES_ACTIVE: "CREATES_ACTIVE",
  CREATES_ACTIVE_ERROR: "CREATES_ACTIVE_ERROR",
  CREATES_TOKEN_PENDING: "CREATES_TOKEN_PENDING",
  CREATES_TOKEN_COMPLETE: "CREATES_TOKEN_COMPLETE",
  CREATES_TOKEN_ERROR: "CREATES_TOKEN_ERROR",
} as const
export const PRIVATE_SUPERVISOR_ERROR_CODE = {
  CREATE_NOT_FOUND: "CREATE_NOT_FOUND",
  UPSTREAM_OBSERVATION_UNAVAILABLE: "UPSTREAM_OBSERVATION_UNAVAILABLE",
} as const
export const PRIVATE_SUPERVISOR_BODY_LIMIT = {
  META: 4_096,
  CREATES_ACTIVE: 65_536,
  CREATES_TOKEN: 32_768,
} as const
export const PRIVATE_SUPERVISOR_RETRY_AFTER_SECONDS = 1 as const
export const PRIVATE_SUPERVISOR_RETRY_AFTER_HEADER_VALUE = `${PRIVATE_SUPERVISOR_RETRY_AFTER_SECONDS}` as const
export const PRIVATE_SUPERVISOR_JSON_CONTENT_TYPE = "application/json; charset=utf-8" as const
export const CREATE_JOURNAL_VERSION = 1 as const

export const WORKER_IDENTITY_HEADER = {
  WORKER_ID: "x-managed-worker-id",
  INSTANCE_ID: "x-managed-worker-instance-id",
} as const
export const MANAGED_CREATE_HEADER = {
  POOL_ID: "x-managed-pool-id",
  MANAGER_INSTANCE_ID: "x-managed-manager-instance-id",
  TOKEN: "x-managed-create-token",
  OWNER_SHA256: "x-managed-owner-sha256",
  REQUEST_SHA256: "x-managed-request-sha256",
} as const
export const MANAGED_CREATE_HEADER_NAMES = Object.freeze(Object.values(MANAGED_CREATE_HEADER))

export const ManagedCreateHeaderValuesSchema = z.object({
  [MANAGED_CREATE_HEADER.POOL_ID]: PoolIdSchema,
  [MANAGED_CREATE_HEADER.MANAGER_INSTANCE_ID]: ManagerInstanceIdSchema,
  [MANAGED_CREATE_HEADER.TOKEN]: CreateTokenSchema,
  [MANAGED_CREATE_HEADER.OWNER_SHA256]: Sha256Schema,
  [MANAGED_CREATE_HEADER.REQUEST_SHA256]: Sha256Schema,
}).strict().readonly()

export const PrivateSupervisorCreateLookupParamsSchema = z.object({
  token: CreateTokenSchema,
}).strict().readonly()
export const buildPrivateSupervisorCreateLookupPath = (token: CreateToken): string => PRIVATE_SUPERVISOR_ROUTE.CREATES_TOKEN.replace(/:token$/u, encodeURIComponent(token))
const EmptyPrivateSupervisorParamsSchema = z.object({}).strict().readonly()

export const WorkerMetadataSchema = z.object({
  workerId: WorkerIdSchema,
  instanceId: InstanceIdSchema,
  upstreamSha: GitCommitShaSchema,
  browserVersion: z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){3}$/u),
  journalVersion: z.literal(CREATE_JOURNAL_VERSION),
}).strict().readonly()

type PendingJournalState = Extract<CreateJournalState, typeof CREATE_JOURNAL_STATE.ACCEPTED | typeof CREATE_JOURNAL_STATE.UPSTREAM_PENDING | typeof CREATE_JOURNAL_STATE.UNCERTAIN>
export type ActiveCreateReplayRecord = Exclude<CreateReplayRecord, { readonly state: typeof CREATE_JOURNAL_STATE.RELEASED_TERMINAL | typeof CREATE_JOURNAL_STATE.FAILED_TERMINAL }>
export type PendingCreateReplayRecord = Extract<CreateReplayRecord, { readonly state: PendingJournalState }>
export type CompleteCreateReplayRecord = Extract<CreateReplayRecord, { readonly state: typeof CREATE_JOURNAL_STATE.LIVE | typeof CREATE_JOURNAL_STATE.RELEASED_TERMINAL | typeof CREATE_JOURNAL_STATE.FAILED_TERMINAL }>

function assertNever(value: never): never {
  throw new TypeError(`unhandled create journal state: ${String(value)}`)
}

function isActiveRecord(record: CreateReplayRecord): record is ActiveCreateReplayRecord {
  const state = record.state
  switch (state) {
    case CREATE_JOURNAL_STATE.ACCEPTED:
    case CREATE_JOURNAL_STATE.UPSTREAM_PENDING:
    case CREATE_JOURNAL_STATE.LIVE:
    case CREATE_JOURNAL_STATE.UNCERTAIN:
      return true
    case CREATE_JOURNAL_STATE.RELEASED_TERMINAL:
    case CREATE_JOURNAL_STATE.FAILED_TERMINAL:
      return false
    default:
      return assertNever(state)
  }
}

function isCompleteRecord(record: CreateReplayRecord): record is CompleteCreateReplayRecord {
  const state = record.state
  switch (state) {
    case CREATE_JOURNAL_STATE.LIVE:
    case CREATE_JOURNAL_STATE.RELEASED_TERMINAL:
    case CREATE_JOURNAL_STATE.FAILED_TERMINAL:
      return true
    case CREATE_JOURNAL_STATE.ACCEPTED:
    case CREATE_JOURNAL_STATE.UPSTREAM_PENDING:
    case CREATE_JOURNAL_STATE.UNCERTAIN:
      return false
    default:
      return assertNever(state)
  }
}

export const ActiveCreateReplayRecordSchema = CreateReplayRecordSchema.refine(isActiveRecord).readonly()
export const PendingCreateReplayRecordSchema = CreateReplayRecordSchema.refine(
  (record): record is PendingCreateReplayRecord => {
    const state = record.state
    switch (state) {
      case CREATE_JOURNAL_STATE.ACCEPTED:
      case CREATE_JOURNAL_STATE.UPSTREAM_PENDING:
      case CREATE_JOURNAL_STATE.UNCERTAIN:
        return true
      case CREATE_JOURNAL_STATE.LIVE:
      case CREATE_JOURNAL_STATE.RELEASED_TERMINAL:
      case CREATE_JOURNAL_STATE.FAILED_TERMINAL:
        return false
      default:
        return assertNever(state)
    }
  },
).readonly()
export const CompleteCreateReplayRecordSchema = CreateReplayRecordSchema.refine(isCompleteRecord).readonly()
export const ActiveCreateEnumerationSchema = z.object({
  creates: z.array(ActiveCreateReplayRecordSchema).max(1).readonly(),
}).strict().readonly()

const ActiveObservationErrorSchema = z.object({
  code: z.literal(PRIVATE_SUPERVISOR_ERROR_CODE.UPSTREAM_OBSERVATION_UNAVAILABLE),
}).strict()
const CreateNotFoundErrorSchema = z.object({
  code: z.literal(PRIVATE_SUPERVISOR_ERROR_CODE.CREATE_NOT_FOUND),
}).strict()
export const PrivateSupervisorErrorSchema = z.discriminatedUnion("code", [
  ActiveObservationErrorSchema,
  CreateNotFoundErrorSchema,
]).readonly()

const canonicalLength = (maximum: number) => z.string().regex(/^(?:0|[1-9][0-9]{0,4})$/u).refine((value) => Number(value) <= maximum)
const jsonHeaderFields = (maximum: number) => ({
  [WORKER_IDENTITY_HEADER.WORKER_ID]: WorkerIdSchema,
  [WORKER_IDENTITY_HEADER.INSTANCE_ID]: InstanceIdSchema,
  "content-type": z.literal(PRIVATE_SUPERVISOR_JSON_CONTENT_TYPE),
  "content-length": canonicalLength(maximum),
})
const jsonHeaders = (maximum: number) => z.object(jsonHeaderFields(maximum)).strict().readonly()
const retryingJsonHeaders = (maximum: number) => z.object({ ...jsonHeaderFields(maximum), "retry-after": z.literal(PRIVATE_SUPERVISOR_RETRY_AFTER_HEADER_VALUE) }).strict().readonly()

const MetaResponseSchema = z.object({ kind: z.literal(PRIVATE_SUPERVISOR_RESPONSE_KIND.META), status: z.literal(PRIVATE_SUPERVISOR_STATUS.OK), headers: jsonHeaders(PRIVATE_SUPERVISOR_BODY_LIMIT.META), body: WorkerMetadataSchema }).strict()
const ActiveResponseSchema = z.object({ kind: z.literal(PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_ACTIVE), status: z.literal(PRIVATE_SUPERVISOR_STATUS.OK), headers: jsonHeaders(PRIVATE_SUPERVISOR_BODY_LIMIT.CREATES_ACTIVE), body: ActiveCreateEnumerationSchema }).strict()
const ActiveErrorResponseSchema = z.object({ kind: z.literal(PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_ACTIVE_ERROR), status: z.literal(PRIVATE_SUPERVISOR_STATUS.UNAVAILABLE), headers: jsonHeaders(PRIVATE_SUPERVISOR_BODY_LIMIT.CREATES_ACTIVE), body: ActiveObservationErrorSchema.readonly() }).strict()
const LookupPendingResponseSchema = z.object({ kind: z.literal(PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_TOKEN_PENDING), status: z.literal(PRIVATE_SUPERVISOR_STATUS.PENDING), headers: retryingJsonHeaders(PRIVATE_SUPERVISOR_BODY_LIMIT.CREATES_TOKEN), body: PendingCreateReplayRecordSchema }).strict()
const LookupCompleteResponseSchema = z.object({ kind: z.literal(PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_TOKEN_COMPLETE), status: z.literal(PRIVATE_SUPERVISOR_STATUS.OK), headers: jsonHeaders(PRIVATE_SUPERVISOR_BODY_LIMIT.CREATES_TOKEN), body: CompleteCreateReplayRecordSchema }).strict()
const LookupErrorResponseSchema = z.object({ kind: z.literal(PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_TOKEN_ERROR), status: z.literal(PRIVATE_SUPERVISOR_STATUS.NOT_FOUND), headers: jsonHeaders(PRIVATE_SUPERVISOR_BODY_LIMIT.CREATES_TOKEN), body: CreateNotFoundErrorSchema.readonly() }).strict()

export const PrivateSupervisorWireResponseSchema = z.discriminatedUnion("kind", [
  MetaResponseSchema,
  ActiveResponseSchema,
  ActiveErrorResponseSchema,
  LookupPendingResponseSchema,
  LookupCompleteResponseSchema,
  LookupErrorResponseSchema,
]).readonly().superRefine((response, context) => {
  const actualLength = new TextEncoder().encode(JSON.stringify(response.body)).byteLength
  if (response.headers["content-length"] !== String(actualLength)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "content-length differs from canonical JSON body" })
  }
})

const MetaRouteResponseSchema = PrivateSupervisorWireResponseSchema.refine((response) => response.kind === PRIVATE_SUPERVISOR_RESPONSE_KIND.META)
const ActiveRouteResponseSchema = PrivateSupervisorWireResponseSchema.refine((response) => response.kind === PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_ACTIVE || response.kind === PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_ACTIVE_ERROR)
const LookupRouteResponseSchema = PrivateSupervisorWireResponseSchema.refine((response) => response.kind === PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_TOKEN_PENDING || response.kind === PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_TOKEN_COMPLETE || response.kind === PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_TOKEN_ERROR)
export const PRIVATE_SUPERVISOR_ROUTE_REGISTRY = Object.freeze([
  Object.freeze({ id: PRIVATE_SUPERVISOR_ROUTE_ID.META, method: PRIVATE_SUPERVISOR_METHOD.GET, path: PRIVATE_SUPERVISOR_ROUTE.META, maxResponseBodyBytes: PRIVATE_SUPERVISOR_BODY_LIMIT.META, paramsSchema: EmptyPrivateSupervisorParamsSchema, responseSchema: MetaRouteResponseSchema }),
  Object.freeze({ id: PRIVATE_SUPERVISOR_ROUTE_ID.CREATES_ACTIVE, method: PRIVATE_SUPERVISOR_METHOD.GET, path: PRIVATE_SUPERVISOR_ROUTE.CREATES_ACTIVE, maxResponseBodyBytes: PRIVATE_SUPERVISOR_BODY_LIMIT.CREATES_ACTIVE, paramsSchema: EmptyPrivateSupervisorParamsSchema, responseSchema: ActiveRouteResponseSchema }),
  Object.freeze({ id: PRIVATE_SUPERVISOR_ROUTE_ID.CREATES_TOKEN, method: PRIVATE_SUPERVISOR_METHOD.GET, path: PRIVATE_SUPERVISOR_ROUTE.CREATES_TOKEN, maxResponseBodyBytes: PRIVATE_SUPERVISOR_BODY_LIMIT.CREATES_TOKEN, paramsSchema: PrivateSupervisorCreateLookupParamsSchema, responseSchema: LookupRouteResponseSchema }),
])

export type ManagedCreateHeaderValues = z.infer<typeof ManagedCreateHeaderValuesSchema>
export type PrivateSupervisorCreateLookupParams = z.infer<typeof PrivateSupervisorCreateLookupParamsSchema>
export type WorkerMetadata = z.infer<typeof WorkerMetadataSchema>
export type ActiveCreateEnumeration = z.infer<typeof ActiveCreateEnumerationSchema>
export type PrivateSupervisorError = z.infer<typeof PrivateSupervisorErrorSchema>
export type PrivateSupervisorWireResponse = z.infer<typeof PrivateSupervisorWireResponseSchema>
export type PrivateSupervisorRoute = (typeof PRIVATE_SUPERVISOR_ROUTE_REGISTRY)[number]
