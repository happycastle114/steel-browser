import { AUTHORIZATION_OPERATION, type AuthorizationOperation } from "./authorization-policy.js"
import {
  AI_ASYNC_OUTCOME_STATE,
  HTTP_RESPONSE_HEADER,
  HTTP_SUCCESS_STATUS,
  type HttpSuccessStatus,
} from "./http-response-contract.js"

export * from "./http-response-contract.js"

export const CONTROL_PLANE_HTTP_METHOD = { GET: "GET", POST: "POST" } as const
export type HttpMethod = (typeof CONTROL_PLANE_HTTP_METHOD)[keyof typeof CONTROL_PLANE_HTTP_METHOD]

export const AI_ROUTE_PATH = {
  CAPABILITIES: "/v1/capabilities",
  TOOLS: "/v1/tools",
  ACTIONS: "/v1/actions",
  RESULT: "/v1/results/:id",
} as const
export const ROUTE_RESPONSE_KIND = {
  FIXED: "FIXED",
  ASYNC_ACTION: "ASYNC_ACTION",
  ASYNC_RESULT: "ASYNC_RESULT",
} as const
export type AiRoutePath = (typeof AI_ROUTE_PATH)[keyof typeof AI_ROUTE_PATH]
export type RouteResponseKind = (typeof ROUTE_RESPONSE_KIND)[keyof typeof ROUTE_RESPONSE_KIND]
export type FixedResponseContract = Readonly<{
  readonly kind: typeof ROUTE_RESPONSE_KIND.FIXED
  readonly status: HttpSuccessStatus
}>
export type ActionResponseContract = Readonly<{
  readonly kind: typeof ROUTE_RESPONSE_KIND.ASYNC_ACTION
  readonly accepted: Readonly<{
    readonly state: typeof AI_ASYNC_OUTCOME_STATE.ACCEPTED
    readonly status: typeof HTTP_SUCCESS_STATUS.ACCEPTED
    readonly requiredHeaders: Readonly<{
      readonly [HTTP_RESPONSE_HEADER.LOCATION]: true
      readonly [HTTP_RESPONSE_HEADER.RETRY_AFTER]: true
    }>
  }>
}>
export type ResultResponseContract = Readonly<{
  readonly kind: typeof ROUTE_RESPONSE_KIND.ASYNC_RESULT
  readonly pending: Readonly<{
    readonly state: typeof AI_ASYNC_OUTCOME_STATE.PENDING
    readonly status: typeof HTTP_SUCCESS_STATUS.ACCEPTED
    readonly requiredHeaders: Readonly<{ readonly [HTTP_RESPONSE_HEADER.RETRY_AFTER]: true }>
  }>
  readonly completed: Readonly<{
    readonly state: typeof AI_ASYNC_OUTCOME_STATE.COMPLETED
    readonly status: typeof HTTP_SUCCESS_STATUS.OK
    readonly requiredHeaders: Readonly<Record<string, never>>
  }>
}>
export type RouteResponseContract = FixedResponseContract | ActionResponseContract | ResultResponseContract

export type RouteContract = Readonly<{
  readonly method: HttpMethod
  readonly path: string
  readonly authorization: AuthorizationOperation
  readonly response: RouteResponseContract
}>

const OK_RESPONSE = { kind: ROUTE_RESPONSE_KIND.FIXED, status: HTTP_SUCCESS_STATUS.OK } as const
const ACCEPTED_RESPONSE = { kind: ROUTE_RESPONSE_KIND.FIXED, status: HTTP_SUCCESS_STATUS.ACCEPTED } as const
const ACTION_RESPONSE = {
  kind: ROUTE_RESPONSE_KIND.ASYNC_ACTION,
  accepted: {
    state: AI_ASYNC_OUTCOME_STATE.ACCEPTED,
    status: HTTP_SUCCESS_STATUS.ACCEPTED,
    requiredHeaders: {
      [HTTP_RESPONSE_HEADER.LOCATION]: true,
      [HTTP_RESPONSE_HEADER.RETRY_AFTER]: true,
    },
  },
} as const satisfies ActionResponseContract
const RESULT_RESPONSE = {
  kind: ROUTE_RESPONSE_KIND.ASYNC_RESULT,
  pending: {
    state: AI_ASYNC_OUTCOME_STATE.PENDING,
    status: HTTP_SUCCESS_STATUS.ACCEPTED,
    requiredHeaders: { [HTTP_RESPONSE_HEADER.RETRY_AFTER]: true },
  },
  completed: {
    state: AI_ASYNC_OUTCOME_STATE.COMPLETED,
    status: HTTP_SUCCESS_STATUS.OK,
    requiredHeaders: {},
  },
} as const satisfies ResultResponseContract

export const MANAGED_ROUTE_REGISTRY = [
  { method: CONTROL_PLANE_HTTP_METHOD.GET, path: "/v1/managed/pool", authorization: AUTHORIZATION_OPERATION.POOL_SUMMARY, response: OK_RESPONSE },
  { method: CONTROL_PLANE_HTTP_METHOD.GET, path: "/v1/managed/workers", authorization: AUTHORIZATION_OPERATION.WORKER_INVENTORY, response: OK_RESPONSE },
  { method: CONTROL_PLANE_HTTP_METHOD.GET, path: "/v1/managed/sessions", authorization: AUTHORIZATION_OPERATION.SESSION_LIST, response: OK_RESPONSE },
  { method: CONTROL_PLANE_HTTP_METHOD.GET, path: "/v1/managed/sessions/:id", authorization: AUTHORIZATION_OPERATION.SESSION_DETAIL, response: OK_RESPONSE },
  { method: CONTROL_PLANE_HTTP_METHOD.GET, path: "/v1/managed/queue", authorization: AUTHORIZATION_OPERATION.QUEUE_GLOBAL, response: OK_RESPONSE },
  { method: CONTROL_PLANE_HTTP_METHOD.GET, path: "/v1/managed/events", authorization: AUTHORIZATION_OPERATION.EVENTS_GLOBAL, response: OK_RESPONSE },
  { method: CONTROL_PLANE_HTTP_METHOD.GET, path: "/v1/managed/admissions/:id", authorization: AUTHORIZATION_OPERATION.ADMISSION_DETAIL, response: OK_RESPONSE },
  { method: CONTROL_PLANE_HTTP_METHOD.GET, path: "/v1/managed/version", authorization: AUTHORIZATION_OPERATION.VERSION, response: OK_RESPONSE },
  { method: CONTROL_PLANE_HTTP_METHOD.POST, path: "/v1/managed/admissions", authorization: AUTHORIZATION_OPERATION.SESSION_CREATE, response: ACCEPTED_RESPONSE },
  { method: CONTROL_PLANE_HTTP_METHOD.POST, path: "/v1/managed/admissions/:id/cancel", authorization: AUTHORIZATION_OPERATION.ADMISSION_CANCEL, response: OK_RESPONSE },
  { method: CONTROL_PLANE_HTTP_METHOD.POST, path: "/v1/managed/sessions/:id/release", authorization: AUTHORIZATION_OPERATION.SESSION_RELEASE, response: OK_RESPONSE },
  { method: CONTROL_PLANE_HTTP_METHOD.POST, path: "/v1/managed/pool/drain", authorization: AUTHORIZATION_OPERATION.POOL_DRAIN, response: OK_RESPONSE },
  { method: CONTROL_PLANE_HTTP_METHOD.POST, path: "/v1/managed/pool/resume", authorization: AUTHORIZATION_OPERATION.POOL_RESUME, response: OK_RESPONSE },
] as const satisfies readonly RouteContract[]

export const AI_ROUTE_REGISTRY = [
  { method: CONTROL_PLANE_HTTP_METHOD.GET, path: AI_ROUTE_PATH.CAPABILITIES, authorization: AUTHORIZATION_OPERATION.CAPABILITIES, response: OK_RESPONSE },
  { method: CONTROL_PLANE_HTTP_METHOD.GET, path: AI_ROUTE_PATH.TOOLS, authorization: AUTHORIZATION_OPERATION.TOOL_DISCOVERY, response: OK_RESPONSE },
  { method: CONTROL_PLANE_HTTP_METHOD.POST, path: AI_ROUTE_PATH.ACTIONS, authorization: AUTHORIZATION_OPERATION.AI_ACTION, response: ACTION_RESPONSE },
  { method: CONTROL_PLANE_HTTP_METHOD.GET, path: AI_ROUTE_PATH.RESULT, authorization: AUTHORIZATION_OPERATION.RESULT_DOWNLOAD, response: RESULT_RESPONSE },
] as const satisfies readonly RouteContract[]

export const FORK_OWNED_V1_ROUTES = Object.freeze([...MANAGED_ROUTE_REGISTRY, ...AI_ROUTE_REGISTRY])
