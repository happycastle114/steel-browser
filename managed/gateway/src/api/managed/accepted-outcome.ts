import {
  AI_ASYNC_OUTCOME_STATE,
  AiResultPendingOutcomeSchema,
  CONTROL_PLANE_API_VERSION,
  HTTP_RESPONSE_HEADER,
  RETRY_AFTER_REASON,
  buildResultDownloadUrl,
  createAiActionAcceptedOutcomeSchema,
  retryAfterSeconds,
  type ResultId,
  type AiResultPendingOutcome,
} from "@happycastle/steel-managed-shared"
import type { AcceptedAction, SubmitActionRequest } from "./service-contract.js"

export function createAcceptedAction(
  resultId: ResultId,
  input: SubmitActionRequest,
  reconcileMs: number,
): AcceptedAction {
  const retry = retryAfterSeconds({ reason: RETRY_AFTER_REASON.RECONCILE, reconcileMs })
  return createAiActionAcceptedOutcomeSchema(input.selectedOrigin).parse({
    status: 202,
    headers: {
      [HTTP_RESPONSE_HEADER.LOCATION]: buildResultDownloadUrl(input.selectedOrigin, resultId),
      [HTTP_RESPONSE_HEADER.RETRY_AFTER]: String(retry),
    },
    body: {
      apiVersion: CONTROL_PLANE_API_VERSION,
      resultId,
      state: AI_ASYNC_OUTCOME_STATE.ACCEPTED,
      retryAfterSeconds: retry,
      requestId: input.context.requestId,
      correlationId: input.context.correlationId,
    },
  })
}

export function createPendingResult(
  resultId: ResultId,
  input: Pick<SubmitActionRequest, "context">,
  reconcileMs: number,
): AiResultPendingOutcome {
  const retry = retryAfterSeconds({ reason: RETRY_AFTER_REASON.RECONCILE, reconcileMs })
  return AiResultPendingOutcomeSchema.parse({
    status: 202,
    headers: { [HTTP_RESPONSE_HEADER.RETRY_AFTER]: String(retry) },
    body: {
      apiVersion: CONTROL_PLANE_API_VERSION,
      resultId,
      state: AI_ASYNC_OUTCOME_STATE.PENDING,
      retryAfterSeconds: retry,
      requestId: input.context.requestId,
      correlationId: input.context.correlationId,
    },
  })
}
