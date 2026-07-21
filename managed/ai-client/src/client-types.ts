import {
  AI_ASYNC_OUTCOME_STATE,
  type AiActionAcceptedBody,
  type AiActionRequest,
  type AiResultCompletedBody,
  type AiResultPendingBody,
  type AiToolPage,
  type BinaryResult,
  type LiveViewResult,
  type ManagedToolResult,
  type ResultId,
  type SessionId,
  type StructuralCapabilities,
} from "@happycastle/steel-managed-shared/ai-client"

export type AiToolPageQuery = Readonly<{ readonly pageSize?: number; readonly cursor?: string }>
export type AiResultQuery = Readonly<{ readonly resultId: ResultId; readonly expectedAction?: AiActionRequest }>
export type AiLiveViewQuery = Readonly<{ readonly resultId: ResultId; readonly sessionId: SessionId }>

export type AiBinaryDownload = Readonly<{
  readonly state: typeof AI_ASYNC_OUTCOME_STATE.COMPLETED
  readonly resultId: ResultId
  readonly result: BinaryResult
  readonly contentType: string
  readonly bytes: Uint8Array
}>

export type AiResultRead = AiResultPendingBody | AiResultCompletedBody<ManagedToolResult> | AiBinaryDownload
export type AiLiveViewRead = AiResultPendingBody | AiResultCompletedBody<LiveViewResult>

export type {
  AiActionAcceptedBody,
  AiActionRequest,
  AiToolPage,
  StructuralCapabilities,
}
