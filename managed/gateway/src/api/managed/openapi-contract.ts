import {
  AI_ACTION_REQUEST_SCHEMA,
  AI_ROUTE_PATH,
  AiActionAcceptedBodySchema,
  AiResultPendingBodySchema,
  CONTROL_PLANE_HTTP_METHOD,
  ControlPlaneApiVersionSchema,
  MANAGED_ERROR_CATALOG,
  MANAGED_ERROR_CODE,
  ManagedErrorEnvelopeSchema,
  OpaqueCursorSchema,
  StructuralCapabilitiesSchema,
  TOOL_NAMES,
  ToolSchemaDescriptorSchema,
  type HttpMethod,
  type ManagedErrorCode,
} from "@happycastle/steel-managed-shared"
import { z, type ZodType } from "zod"

export const AI_OPENAPI_COMPONENT = {
  ACTION_ACCEPTED: "AiActionAccepted",
  ACTION_REQUEST: "AiActionRequest",
  CAPABILITIES: "AiCapabilities",
  ERROR: "ManagedErrorEnvelope",
  RESULT_COMPLETED: "AiResultCompleted",
  RESULT_PENDING: "AiResultPending",
  TOOL_PAGE: "AiToolPage",
} as const

export const AI_OPENAPI_OPERATION_KIND = {
  ACTION: "ACTION",
  CAPABILITIES: "CAPABILITIES",
  RESULT: "RESULT",
  TOOLS: "TOOLS",
} as const

export const AI_OPENAPI_OPERATION_ID = {
  GET_CAPABILITIES: "getAiCapabilities",
  LIST_TOOLS: "listAiTools",
  SUBMIT_ACTION: "submitAiAction",
  GET_RESULT: "getAiResult",
} as const

type AiOpenApiOperationKind =
  (typeof AI_OPENAPI_OPERATION_KIND)[keyof typeof AI_OPENAPI_OPERATION_KIND]

export type AiOpenApiOperation = Readonly<{
  readonly errorCodes: readonly ManagedErrorCode[]
  readonly errorStatuses: readonly number[]
  readonly kind: AiOpenApiOperationKind
  readonly method: HttpMethod
  readonly operationId: (typeof AI_OPENAPI_OPERATION_ID)[keyof typeof AI_OPENAPI_OPERATION_ID]
  readonly path: string
}>

type OperationInput = Omit<AiOpenApiOperation, "errorStatuses">

const READ_ERRORS = [
  MANAGED_ERROR_CODE.ACCESS_AUTH_REQUIRED,
  MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE,
] as const
const TOOL_ERRORS = [MANAGED_ERROR_CODE.INVALID_CURSOR, ...READ_ERRORS] as const
const ACTION_ERRORS = [
  MANAGED_ERROR_CODE.INVALID_ARGUMENT,
  MANAGED_ERROR_CODE.ACCESS_AUTH_REQUIRED,
  MANAGED_ERROR_CODE.ACCESS_FORBIDDEN,
  MANAGED_ERROR_CODE.BODY_TOO_LARGE,
  MANAGED_ERROR_CODE.UNSUPPORTED_MEDIA_TYPE,
  MANAGED_ERROR_CODE.TOOL_INPUT_INVALID,
  MANAGED_ERROR_CODE.RESULT_TOO_LARGE,
  MANAGED_ERROR_CODE.MANAGED_AI_RESULT_CAPACITY,
  MANAGED_ERROR_CODE.MANAGED_ACTION_CAPACITY,
  MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE,
  MANAGED_ERROR_CODE.TOOL_TIMEOUT,
] as const
const RESULT_ERRORS = [
  MANAGED_ERROR_CODE.INVALID_ARGUMENT,
  MANAGED_ERROR_CODE.ACCESS_AUTH_REQUIRED,
  MANAGED_ERROR_CODE.ACCESS_FORBIDDEN,
  MANAGED_ERROR_CODE.RESULT_NOT_FOUND,
  MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE,
] as const

const AiToolPageDocumentationSchema = z.object({
  apiVersion: ControlPlaneApiVersionSchema,
  items: z.array(ToolSchemaDescriptorSchema).max(TOOL_NAMES.length),
  page: z.object({
    pageSize: z.number().int().min(1).max(TOOL_NAMES.length),
    hasMore: z.boolean(),
    nextCursor: OpaqueCursorSchema.optional(),
  }).strict(),
}).strict()

function operation(input: OperationInput): AiOpenApiOperation {
  return Object.freeze({
    ...input,
    errorStatuses: Object.freeze([...new Set(input.errorCodes.map(errorStatus))].sort((left, right) => left - right)),
  })
}

function errorStatus(code: ManagedErrorCode): number {
  return MANAGED_ERROR_CATALOG[code].status
}

export const AI_OPENAPI_OPERATIONS = Object.freeze([
  operation({ kind: AI_OPENAPI_OPERATION_KIND.CAPABILITIES, method: CONTROL_PLANE_HTTP_METHOD.GET, path: AI_ROUTE_PATH.CAPABILITIES, operationId: AI_OPENAPI_OPERATION_ID.GET_CAPABILITIES, errorCodes: READ_ERRORS }),
  operation({ kind: AI_OPENAPI_OPERATION_KIND.TOOLS, method: CONTROL_PLANE_HTTP_METHOD.GET, path: AI_ROUTE_PATH.TOOLS, operationId: AI_OPENAPI_OPERATION_ID.LIST_TOOLS, errorCodes: TOOL_ERRORS }),
  operation({ kind: AI_OPENAPI_OPERATION_KIND.ACTION, method: CONTROL_PLANE_HTTP_METHOD.POST, path: AI_ROUTE_PATH.ACTIONS, operationId: AI_OPENAPI_OPERATION_ID.SUBMIT_ACTION, errorCodes: ACTION_ERRORS }),
  operation({ kind: AI_OPENAPI_OPERATION_KIND.RESULT, method: CONTROL_PLANE_HTTP_METHOD.GET, path: AI_ROUTE_PATH.RESULT, operationId: AI_OPENAPI_OPERATION_ID.GET_RESULT, errorCodes: RESULT_ERRORS }),
])

export const AI_OPENAPI_SCHEMAS = {
  [AI_OPENAPI_COMPONENT.ACTION_ACCEPTED]: AiActionAcceptedBodySchema,
  [AI_OPENAPI_COMPONENT.ACTION_REQUEST]: AI_ACTION_REQUEST_SCHEMA,
  [AI_OPENAPI_COMPONENT.CAPABILITIES]: StructuralCapabilitiesSchema,
  [AI_OPENAPI_COMPONENT.ERROR]: ManagedErrorEnvelopeSchema,
  [AI_OPENAPI_COMPONENT.RESULT_PENDING]: AiResultPendingBodySchema,
  [AI_OPENAPI_COMPONENT.TOOL_PAGE]: AiToolPageDocumentationSchema,
} satisfies Readonly<Record<string, ZodType>>
