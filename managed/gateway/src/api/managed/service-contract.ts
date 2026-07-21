import type {
  AiActionAcceptedOutcome,
  AiActionRequest,
  AiResultPendingOutcome,
  JsonValue,
  ResultId,
  SelectedPublicOrigin,
} from "@happycastle/steel-managed-shared"
import type { ActionCapacitySnapshot } from "./action-capacity.js"
import type { AuthenticatedPrincipal, RequestContext } from "./execution-contract.js"

export const COMPLETED_ACTION_KIND = {
  JSON: "JSON",
  BINARY: "BINARY",
} as const

export const RESULT_LOOKUP_KIND = {
  PENDING: "PENDING",
  COMPLETED: "COMPLETED",
} as const

export type CompletedAction =
  | Readonly<{
    readonly kind: typeof COMPLETED_ACTION_KIND.JSON
    readonly resultId: ResultId
    readonly action: AiActionRequest
    readonly output: JsonValue
  }>
  | Readonly<{
    readonly kind: typeof COMPLETED_ACTION_KIND.BINARY
    readonly resultId: ResultId
    readonly action: AiActionRequest
    readonly output: JsonValue
    readonly bytes: Uint8Array
    readonly contentType: string
  }>

export type ResultLookup =
  | Readonly<{
    readonly kind: typeof RESULT_LOOKUP_KIND.PENDING
    readonly outcome: AiResultPendingOutcome
  }>
  | Readonly<{
    readonly kind: typeof RESULT_LOOKUP_KIND.COMPLETED
    readonly value: CompletedAction
  }>

export type SubmitActionRequest = Readonly<{
  readonly action: unknown
  readonly principal: AuthenticatedPrincipal
  readonly context: RequestContext
  readonly selectedOrigin: SelectedPublicOrigin
  readonly signal: AbortSignal
}>

export type ResultRequest = Readonly<{
  readonly resultId: ResultId
  readonly principal: AuthenticatedPrincipal
  readonly context: RequestContext
  readonly selectedOrigin: SelectedPublicOrigin
}>

export type AcceptedAction = AiActionAcceptedOutcome

export type ManagedAiGauges<ResultSnapshot> = Readonly<{
  readonly action: ActionCapacitySnapshot
  readonly result: ResultSnapshot
}>
