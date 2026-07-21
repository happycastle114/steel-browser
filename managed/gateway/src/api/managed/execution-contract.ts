import {
  AI_ACTION_REQUEST_SCHEMA,
  JsonValueSchema,
  PrincipalIdSchema,
  PrincipalRoleSchema,
  ResultIdSchema,
  UuidSchema,
  type AiActionRequest,
  type PrincipalId,
  type ResultId,
  type SelectedPublicOrigin,
} from "@happycastle/steel-managed-shared"
import type { FastifyRequest } from "fastify"
import { z } from "zod"

export const AuthenticatedPrincipalSchema = z.object({
  principalId: PrincipalIdSchema,
  role: PrincipalRoleSchema,
}).strict().readonly()
export type AuthenticatedPrincipal = z.infer<typeof AuthenticatedPrincipalSchema>

export const RequestContextSchema = z.object({
  requestId: UuidSchema,
  correlationId: UuidSchema,
}).strict().readonly()
export type RequestContext = z.infer<typeof RequestContextSchema>

export type ManagedRequestIdentity = Readonly<{
  readonly principal: AuthenticatedPrincipal
  readonly context: RequestContext
  readonly selectedOrigin: SelectedPublicOrigin
}>

export type ManagedRequestIdentityProvider = (
  request: FastifyRequest,
) => ManagedRequestIdentity | Promise<ManagedRequestIdentity>

export type ManagedExecutionInvocation = Readonly<{
  readonly resultId: ResultId
  readonly action: AiActionRequest
  readonly principal: AuthenticatedPrincipal
  readonly context: RequestContext
  readonly selectedOrigin: SelectedPublicOrigin
  readonly signal: AbortSignal
}>

export type ManagedExecutionCompletion = Readonly<{
  readonly resultId: ResultId
  readonly action: AiActionRequest
  readonly ownerId: PrincipalId
  readonly completedAtMs: number
  readonly output: z.infer<typeof JsonValueSchema>
  readonly binaryBytes?: Uint8Array | undefined
}>

export const ManagedExecutionCompletionSchema = z.object({
  resultId: ResultIdSchema,
  action: AI_ACTION_REQUEST_SCHEMA,
  ownerId: PrincipalIdSchema,
  completedAtMs: z.number().int().nonnegative().safe(),
  output: JsonValueSchema,
  binaryBytes: z.instanceof(Uint8Array).optional(),
}).strict().readonly()

export interface ControlPlaneExecutionPort {
  execute(invocation: ManagedExecutionInvocation): Promise<unknown>
}

export const AI_AUDIT_REASON = {
  INVALID_RESULT_CONTRACT: "INVALID_RESULT_CONTRACT",
  RESULT_STORE_FAILURE: "RESULT_STORE_FAILURE",
  LEDGER_ANOMALY: "LEDGER_ANOMALY",
  CORRUPT_RETAINED_RECORD: "CORRUPT_RETAINED_RECORD",
} as const
export type AiAuditReason = (typeof AI_AUDIT_REASON)[keyof typeof AI_AUDIT_REASON]

export type AiAuditEvent = Readonly<{
  readonly reason: AiAuditReason
  readonly resultId: ResultId
  readonly principalId: PrincipalId
}>

export interface AiAuditSink {
  record(event: AiAuditEvent): void
}
