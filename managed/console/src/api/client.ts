import ky, { HTTPError, TimeoutError, type KyInstance } from "ky"
import { z } from "zod"

import { ActionKind, ManagedAdmissionOperation, assertNever } from "../domain/vocabulary.js"
import { EventListSchema, type EventList } from "./schema-events.js"
import {
  ActionResultSchema,
  BrowserActionInputSchema,
  CapabilitiesSchema,
  LiveViewResultSchema,
  ToolsResponseSchema,
  SessionCreateResultSchema,
  type ActionResult,
  type BrowserActionInput,
  type Capabilities,
  type LiveViewResult,
  type ToolsResponse,
  type SessionCreateResult,
} from "./schema-integrations.js"
import { PoolSchema, type Pool } from "./schema-pool.js"
import { CONTROL_PLANE_API_VERSION, type AdmissionId, type SessionId } from "./schema-primitives.js"
import {
  AdmissionListSchema,
  AdmissionSchema,
  SessionListSchema,
  SessionSchema,
  VersionSchema,
  WorkerListSchema,
  type Admission,
  type AdmissionList,
  type Session,
  type SessionList,
  type Version,
  type WorkerList,
} from "./schema-resources.js"

export const ApiPath = {
  ACTIONS: "/v1/actions",
  ADMISSIONS: "/v1/managed/admissions",
  CAPABILITIES: "/v1/capabilities",
  EVENTS: "/v1/managed/events",
  MCP: "/mcp",
  POOL: "/v1/managed/pool",
  QUEUE: "/v1/managed/queue",
  RESULTS: "/v1/results",
  SESSIONS: "/v1/managed/sessions",
  TOOLS: "/v1/tools",
  VERSION: "/v1/managed/version",
  WORKERS: "/v1/managed/workers",
} as const

const ApiResourcePath = {
  CAST: (sessionId: SessionId) => `/v1/sessions/${encodeURIComponent(sessionId)}/cast`,
  VIEWER: (sessionId: SessionId) => `/ui/sessions/${encodeURIComponent(sessionId)}/live`,
} as const

export const ApiFailureKind = {
  AUTHENTICATION: "AUTHENTICATION",
  FORBIDDEN: "FORBIDDEN",
  MISSING: "MISSING",
  NETWORK: "NETWORK",
  PROTOCOL: "PROTOCOL",
  SERVER: "SERVER",
} as const
export type ApiFailureKind = (typeof ApiFailureKind)[keyof typeof ApiFailureKind]

export const MutationCertainty = {
  INDETERMINATE: "INDETERMINATE",
  REJECTED: "REJECTED",
} as const
export type MutationCertainty = (typeof MutationCertainty)[keyof typeof MutationCertainty]

type ApiFailure = Readonly<{ readonly kind: ApiFailureKind; readonly message: string; readonly status?: number }>

export class ManagedApiError extends Error {
  override readonly name = "ManagedApiError"
  readonly kind: ApiFailureKind
  readonly status?: number
  readonly mutationCertainty: MutationCertainty

  constructor(failure: ApiFailure, mutationCertainty: MutationCertainty = MutationCertainty.INDETERMINATE) {
    super(failure.message)
    this.kind = failure.kind
    if (failure.status !== undefined) this.status = failure.status
    this.mutationCertainty = mutationCertainty
  }
}

export interface ManagedApi {
  action(input: BrowserActionInput): Promise<ActionResult>
  admission(id: AdmissionId): Promise<Admission>
  admissions(): Promise<AdmissionList>
  cancelAdmission(id: AdmissionId): Promise<Admission>
  capabilities(): Promise<Capabilities>
  createSession(idempotencyKey: string): Promise<SessionCreateResult>
  events(): Promise<EventList>
  liveView(id: SessionId): Promise<LiveViewResult>
  pool(): Promise<Pool>
  releaseSession(id: SessionId): Promise<Session>
  session(id: SessionId): Promise<Session>
  sessions(): Promise<SessionList>
  tools(): Promise<ToolsResponse>
  version(): Promise<Version>
  workers(): Promise<WorkerList>
}

const defaultHttp = ky.create({
  credentials: "same-origin",
  retry: 0,
  timeout: 10_000,
})

export function createManagedApi(http: KyInstance = defaultHttp): ManagedApi {
  return {
    action: (input) => postAction(http, input),
    admission: async (id) => assertAdmissionIdentity(id, await parseJson(http.get(endpoint(`${ApiPath.ADMISSIONS}/${encodeURIComponent(id)}`)), AdmissionSchema)),
    admissions: () => parseJson(http.get(endpoint(ApiPath.QUEUE)), AdmissionListSchema),
    cancelAdmission: async (id) => assertAdmissionIdentity(id, await parseJson(http.post(endpoint(`${ApiPath.ADMISSIONS}/${encodeURIComponent(id)}/cancel`), { json: {} }), AdmissionSchema)),
    capabilities: () => parseJson(http.get(endpoint(ApiPath.CAPABILITIES)), CapabilitiesSchema),
    createSession: (idempotencyKey) => parseJson(http.post(endpoint(ApiPath.ADMISSIONS), { json: { idempotencyKey, operation: ManagedAdmissionOperation.SESSION_CREATE } }), SessionCreateResultSchema),
    events: () => parseJson(http.get(endpoint(ApiPath.EVENTS)), EventListSchema),
    liveView: (id) => postLiveView(http, id),
    pool: () => parseJson(http.get(endpoint(ApiPath.POOL)), PoolSchema),
    releaseSession: async (id) => assertSessionIdentity(id, await parseJson(http.post(endpoint(`${ApiPath.SESSIONS}/${encodeURIComponent(id)}/release`), { json: {} }), SessionSchema)),
    session: async (id) => assertSessionIdentity(id, await parseJson(http.get(endpoint(`${ApiPath.SESSIONS}/${encodeURIComponent(id)}`)), SessionSchema)),
    sessions: () => parseJson(http.get(endpoint(ApiPath.SESSIONS)), SessionListSchema),
    tools: () => parseJson(http.get(endpoint(ApiPath.TOOLS)), ToolsResponseSchema),
    version: () => parseJson(http.get(endpoint(ApiPath.VERSION)), VersionSchema),
    workers: () => parseJson(http.get(endpoint(ApiPath.WORKERS)), WorkerListSchema),
  }
}

function endpoint(path: string): string {
  return new URL(path, globalThis.location.origin).toString()
}

async function parseJson<Schema extends z.ZodTypeAny>(request: Promise<Response>, schema: Schema): Promise<z.output<Schema>> {
  try {
    const response = await request
    const payload: unknown = await response.json()
    return schema.parse(payload)
  } catch (error) {
    throw classifyFailure(error)
  }
}

function classifyFailure(error: unknown): Error {
  if (error instanceof ManagedApiError) return error
  if (error instanceof HTTPError) return httpFailure(error.response.status)
  if (error instanceof z.ZodError) return new ManagedApiError({ kind: ApiFailureKind.PROTOCOL, message: "Manager response did not match the public contract." })
  if (error instanceof TimeoutError || error instanceof TypeError) return new ManagedApiError({ kind: ApiFailureKind.NETWORK, message: "The manager could not be reached." })
  return error instanceof Error ? error : new ManagedApiError({ kind: ApiFailureKind.PROTOCOL, message: "The manager returned an unknown failure." })
}

function httpFailure(status: number): ManagedApiError {
  if (status === 401) return new ManagedApiError({ kind: ApiFailureKind.AUTHENTICATION, message: "Cloudflare Access authentication is required.", status }, MutationCertainty.REJECTED)
  if (status === 403) return new ManagedApiError({ kind: ApiFailureKind.FORBIDDEN, message: "This identity cannot access the requested Steel resource.", status }, MutationCertainty.REJECTED)
  if (status === 404) return new ManagedApiError({ kind: ApiFailureKind.MISSING, message: "The requested Steel resource was not found.", status }, MutationCertainty.REJECTED)
  if (status >= 500) return new ManagedApiError({ kind: ApiFailureKind.SERVER, message: "The Steel manager could not complete the request.", status })
  return new ManagedApiError({ kind: ApiFailureKind.PROTOCOL, message: "The Steel manager rejected the request.", status }, MutationCertainty.REJECTED)
}

function actionArguments(input: BrowserActionInput) {
  switch (input.kind) {
    case ActionKind.NAVIGATE:
      return { sessionId: input.sessionId, url: input.url }
    case ActionKind.SNAPSHOT:
      return { sessionId: input.sessionId }
    case ActionKind.SCREENSHOT:
      return { ...(input.format ? { format: input.format } : {}), ...(input.fullPage === undefined ? {} : { fullPage: input.fullPage }), sessionId: input.sessionId }
    case ActionKind.SCRAPE:
      return { format: input.format, sessionId: input.sessionId }
    case ActionKind.CLICK:
      return { selector: input.selector, sessionId: input.sessionId }
    case ActionKind.TYPE:
      return { ...(input.clear === undefined ? {} : { clear: input.clear }), selector: input.selector, sessionId: input.sessionId, text: input.text }
    case ActionKind.KEY:
      return { key: input.key, sessionId: input.sessionId }
    default:
      return assertNever(input)
  }
}

async function postAction(http: KyInstance, untrustedInput: BrowserActionInput): Promise<ActionResult> {
  const input = BrowserActionInputSchema.parse(untrustedInput)
  const result = await parseJson(http.post(endpoint(ApiPath.ACTIONS), {
    json: { apiVersion: CONTROL_PLANE_API_VERSION, arguments: actionArguments(input), tool: { name: input.kind, version: "1.0.0" } },
  }), ActionResultSchema)
  if (result.sessionId !== input.sessionId) throw identityFailure("Action result did not bind to the requested session.")
  return result
}

async function postLiveView(http: KyInstance, sessionId: SessionId): Promise<LiveViewResult> {
  const result = await parseJson(http.post(endpoint(ApiPath.ACTIONS), {
    json: { apiVersion: CONTROL_PLANE_API_VERSION, arguments: { sessionId }, tool: { name: "steel.browser.live_view", version: "1.0.0" } },
  }), LiveViewResultSchema)
  const viewerUrl = new URL(result.viewerUrl)
  const castUrl = new URL(result.castWebSocketUrl)
  const castOrigin = castUrl.origin.replace(/^ws/u, "http")
  const invalidBinding = result.sessionId !== sessionId || viewerUrl.origin !== globalThis.location.origin || castOrigin !== globalThis.location.origin ||
    viewerUrl.pathname !== ApiResourcePath.VIEWER(sessionId) || castUrl.pathname !== ApiResourcePath.CAST(sessionId) ||
    viewerUrl.search !== "" || viewerUrl.hash !== "" || castUrl.search !== "" || castUrl.hash !== ""
  if (invalidBinding) {
    throw new ManagedApiError({ kind: ApiFailureKind.PROTOCOL, message: "Live-view URLs did not bind to the current public origin." })
  }
  return result
}

function assertAdmissionIdentity(requested: AdmissionId, admission: Admission): Admission {
  if (admission.admissionId !== requested) throw identityFailure("Admission response did not bind to the requested admission.")
  return admission
}

function assertSessionIdentity(requested: SessionId, session: Session): Session {
  if (session.sessionId !== requested) throw identityFailure("Session response did not bind to the requested session.")
  return session
}

function identityFailure(message: string): ManagedApiError {
  return new ManagedApiError({ kind: ApiFailureKind.PROTOCOL, message })
}
