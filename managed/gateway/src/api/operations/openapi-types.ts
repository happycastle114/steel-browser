import {
  AdmissionListSchema,
  AdmissionSchema,
  EmptyManagedMutationBodySchema,
  EventListSchema,
  MANAGED_ROUTE_REGISTRY,
  ManagedAdmissionCreateRequestSchema,
  ManagedErrorEnvelopeSchema,
  PoolDrainRequestSchema,
  PoolResumeRequestSchema,
  PoolSchema,
  SessionListSchema,
  SessionSchema,
  VersionSchema,
  WorkerListSchema,
  type HttpMethod,
  type ManagedErrorCode,
} from "@happycastle/steel-managed-shared";
import type { ZodTypeAny } from "zod";

export const MANAGED_OPENAPI_COMPONENT = {
  ADMISSION: "Admission",
  ADMISSION_CREATE: "ManagedAdmissionCreateRequest",
  ADMISSION_LIST: "AdmissionList",
  EMPTY_MUTATION: "EmptyManagedMutationBody",
  EVENT_LIST: "EventList",
  MANAGED_ERROR: "ManagedErrorEnvelope",
  POOL: "Pool",
  POOL_DRAIN: "PoolDrainRequest",
  POOL_RESUME: "PoolResumeRequest",
  SESSION: "Session",
  SESSION_LIST: "SessionList",
  VERSION: "Version",
  WORKER_LIST: "WorkerList",
} as const;

export const MANAGED_OPERATION_ID = {
  CANCEL_ADMISSION: "cancelManagedAdmission",
  CREATE_ADMISSION: "createManagedAdmission",
  DRAIN_POOL: "drainManagedPool",
  GET_ADMISSION: "getManagedAdmission",
  GET_POOL: "getManagedPool",
  GET_SESSION: "getManagedSession",
  GET_VERSION: "getManagedVersion",
  LIST_EVENTS: "listManagedEvents",
  LIST_QUEUE: "listManagedQueue",
  LIST_SESSIONS: "listManagedSessions",
  LIST_WORKERS: "listManagedWorkers",
  RELEASE_SESSION: "releaseManagedSession",
  RESUME_POOL: "resumeManagedPool",
} as const;

export type OpenApiParameter = Readonly<{
  in: "path" | "query";
  name: string;
  required: boolean;
  schema: Readonly<Record<string, unknown>>;
  style?: "form";
  explode?: boolean;
}>;

export type ManagedOpenApiOperation = Readonly<{
  errorCodes: readonly ManagedErrorCode[];
  errorStatuses: readonly number[];
  method: HttpMethod;
  operationId: (typeof MANAGED_OPERATION_ID)[keyof typeof MANAGED_OPERATION_ID];
  parameters: readonly OpenApiParameter[];
  path: string;
  requestComponent?: string;
  responseComponent: string;
  successStatus: 200 | 202;
}>;

export type ManagedOpenApiOperationSource = Omit<
  ManagedOpenApiOperation,
  "errorStatuses"
>;

export const MANAGED_OPENAPI_SCHEMAS = {
  [MANAGED_OPENAPI_COMPONENT.ADMISSION]: AdmissionSchema,
  [MANAGED_OPENAPI_COMPONENT.ADMISSION_CREATE]:
    ManagedAdmissionCreateRequestSchema,
  [MANAGED_OPENAPI_COMPONENT.ADMISSION_LIST]: AdmissionListSchema,
  [MANAGED_OPENAPI_COMPONENT.EMPTY_MUTATION]: EmptyManagedMutationBodySchema,
  [MANAGED_OPENAPI_COMPONENT.EVENT_LIST]: EventListSchema,
  [MANAGED_OPENAPI_COMPONENT.MANAGED_ERROR]: ManagedErrorEnvelopeSchema,
  [MANAGED_OPENAPI_COMPONENT.POOL]: PoolSchema,
  [MANAGED_OPENAPI_COMPONENT.POOL_DRAIN]: PoolDrainRequestSchema,
  [MANAGED_OPENAPI_COMPONENT.POOL_RESUME]: PoolResumeRequestSchema,
  [MANAGED_OPENAPI_COMPONENT.SESSION]: SessionSchema,
  [MANAGED_OPENAPI_COMPONENT.SESSION_LIST]: SessionListSchema,
  [MANAGED_OPENAPI_COMPONENT.VERSION]: VersionSchema,
  [MANAGED_OPENAPI_COMPONENT.WORKER_LIST]: WorkerListSchema,
} satisfies Readonly<Record<string, ZodTypeAny>>;

export function managedRegistryIdentity() {
  return MANAGED_ROUTE_REGISTRY.map(({ method, path, response }) => ({
    method,
    path,
    successStatus: response.status,
  }));
}
