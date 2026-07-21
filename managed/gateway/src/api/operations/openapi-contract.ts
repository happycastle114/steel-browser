import {
  CONTROL_PLANE_HTTP_METHOD,
  MANAGED_ERROR_CATALOG,
} from "@happycastle/steel-managed-shared";
import {
  ADMISSION_DETAIL_ERRORS,
  ADMISSION_MUTATION_ERRORS,
  CREATE_ERRORS,
  EVENT_ERRORS,
  LIST_ERRORS,
  OPERATOR_LIST_ERRORS,
  POOL_MUTATION_ERRORS,
  READ_ERRORS,
  SESSION_DETAIL_ERRORS,
  SESSION_MUTATION_ERRORS,
} from "./openapi-errors.js";
import {
  EVENT_LIST_PARAMETERS,
  QUEUE_LIST_PARAMETERS,
  SESSION_LIST_PARAMETERS,
  UUID_PARAMETER,
  WORKER_LIST_PARAMETERS,
} from "./openapi-parameters.js";
import {
  MANAGED_OPENAPI_COMPONENT,
  MANAGED_OPERATION_ID,
  type ManagedOpenApiOperation,
  type ManagedOpenApiOperationSource,
} from "./openapi-types.js";

function operation(
  value: ManagedOpenApiOperationSource,
): ManagedOpenApiOperation {
  const errorStatuses = Array.from(
    new Set(value.errorCodes.map((code) => MANAGED_ERROR_CATALOG[code].status)),
  ).sort((left, right) => left - right);
  return { ...value, errorStatuses };
}

export const MANAGED_OPENAPI_OPERATIONS = [
  operation({
    method: CONTROL_PLANE_HTTP_METHOD.GET,
    path: "/v1/managed/pool",
    operationId: MANAGED_OPERATION_ID.GET_POOL,
    successStatus: 200,
    responseComponent: MANAGED_OPENAPI_COMPONENT.POOL,
    parameters: [],
    errorCodes: READ_ERRORS,
  }),
  operation({
    method: CONTROL_PLANE_HTTP_METHOD.GET,
    path: "/v1/managed/workers",
    operationId: MANAGED_OPERATION_ID.LIST_WORKERS,
    successStatus: 200,
    responseComponent: MANAGED_OPENAPI_COMPONENT.WORKER_LIST,
    parameters: WORKER_LIST_PARAMETERS,
    errorCodes: OPERATOR_LIST_ERRORS,
  }),
  operation({
    method: CONTROL_PLANE_HTTP_METHOD.GET,
    path: "/v1/managed/sessions",
    operationId: MANAGED_OPERATION_ID.LIST_SESSIONS,
    successStatus: 200,
    responseComponent: MANAGED_OPENAPI_COMPONENT.SESSION_LIST,
    parameters: SESSION_LIST_PARAMETERS,
    errorCodes: LIST_ERRORS,
  }),
  operation({
    method: CONTROL_PLANE_HTTP_METHOD.GET,
    path: "/v1/managed/sessions/:id",
    operationId: MANAGED_OPERATION_ID.GET_SESSION,
    successStatus: 200,
    responseComponent: MANAGED_OPENAPI_COMPONENT.SESSION,
    parameters: [UUID_PARAMETER],
    errorCodes: SESSION_DETAIL_ERRORS,
  }),
  operation({
    method: CONTROL_PLANE_HTTP_METHOD.GET,
    path: "/v1/managed/queue",
    operationId: MANAGED_OPERATION_ID.LIST_QUEUE,
    successStatus: 200,
    responseComponent: MANAGED_OPENAPI_COMPONENT.ADMISSION_LIST,
    parameters: QUEUE_LIST_PARAMETERS,
    errorCodes: OPERATOR_LIST_ERRORS,
  }),
  operation({
    method: CONTROL_PLANE_HTTP_METHOD.GET,
    path: "/v1/managed/events",
    operationId: MANAGED_OPERATION_ID.LIST_EVENTS,
    successStatus: 200,
    responseComponent: MANAGED_OPENAPI_COMPONENT.EVENT_LIST,
    parameters: EVENT_LIST_PARAMETERS,
    errorCodes: EVENT_ERRORS,
  }),
  operation({
    method: CONTROL_PLANE_HTTP_METHOD.GET,
    path: "/v1/managed/admissions/:id",
    operationId: MANAGED_OPERATION_ID.GET_ADMISSION,
    successStatus: 200,
    responseComponent: MANAGED_OPENAPI_COMPONENT.ADMISSION,
    parameters: [UUID_PARAMETER],
    errorCodes: ADMISSION_DETAIL_ERRORS,
  }),
  operation({
    method: CONTROL_PLANE_HTTP_METHOD.GET,
    path: "/v1/managed/version",
    operationId: MANAGED_OPERATION_ID.GET_VERSION,
    successStatus: 200,
    responseComponent: MANAGED_OPENAPI_COMPONENT.VERSION,
    parameters: [],
    errorCodes: READ_ERRORS,
  }),
  operation({
    method: CONTROL_PLANE_HTTP_METHOD.POST,
    path: "/v1/managed/admissions",
    operationId: MANAGED_OPERATION_ID.CREATE_ADMISSION,
    successStatus: 202,
    requestComponent: MANAGED_OPENAPI_COMPONENT.ADMISSION_CREATE,
    responseComponent: MANAGED_OPENAPI_COMPONENT.ADMISSION,
    parameters: [],
    errorCodes: CREATE_ERRORS,
  }),
  operation({
    method: CONTROL_PLANE_HTTP_METHOD.POST,
    path: "/v1/managed/admissions/:id/cancel",
    operationId: MANAGED_OPERATION_ID.CANCEL_ADMISSION,
    successStatus: 200,
    requestComponent: MANAGED_OPENAPI_COMPONENT.EMPTY_MUTATION,
    responseComponent: MANAGED_OPENAPI_COMPONENT.ADMISSION,
    parameters: [UUID_PARAMETER],
    errorCodes: ADMISSION_MUTATION_ERRORS,
  }),
  operation({
    method: CONTROL_PLANE_HTTP_METHOD.POST,
    path: "/v1/managed/sessions/:id/release",
    operationId: MANAGED_OPERATION_ID.RELEASE_SESSION,
    successStatus: 200,
    requestComponent: MANAGED_OPENAPI_COMPONENT.EMPTY_MUTATION,
    responseComponent: MANAGED_OPENAPI_COMPONENT.SESSION,
    parameters: [UUID_PARAMETER],
    errorCodes: SESSION_MUTATION_ERRORS,
  }),
  operation({
    method: CONTROL_PLANE_HTTP_METHOD.POST,
    path: "/v1/managed/pool/drain",
    operationId: MANAGED_OPERATION_ID.DRAIN_POOL,
    successStatus: 200,
    requestComponent: MANAGED_OPENAPI_COMPONENT.POOL_DRAIN,
    responseComponent: MANAGED_OPENAPI_COMPONENT.POOL,
    parameters: [],
    errorCodes: POOL_MUTATION_ERRORS,
  }),
  operation({
    method: CONTROL_PLANE_HTTP_METHOD.POST,
    path: "/v1/managed/pool/resume",
    operationId: MANAGED_OPERATION_ID.RESUME_POOL,
    successStatus: 200,
    requestComponent: MANAGED_OPENAPI_COMPONENT.POOL_RESUME,
    responseComponent: MANAGED_OPENAPI_COMPONENT.POOL,
    parameters: [],
    errorCodes: POOL_MUTATION_ERRORS,
  }),
] as const satisfies readonly ManagedOpenApiOperation[];

export {
  MANAGED_OPENAPI_COMPONENT,
  MANAGED_OPENAPI_SCHEMAS,
  MANAGED_OPERATION_ID,
  managedRegistryIdentity,
} from "./openapi-types.js";
export type {
  ManagedOpenApiOperation,
  OpenApiParameter,
} from "./openapi-types.js";
