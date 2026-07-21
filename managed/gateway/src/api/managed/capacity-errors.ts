import {
  AI_RESULT_CAPACITY_STATE,
  MANAGED_ERROR_CODE,
  RESULT_RESERVATION_STATE,
  RETRY_POLICY_CAUSE,
  retryMetadataFor,
  type ResultCapacityExhaustion,
} from "@happycastle/steel-managed-shared"
import { ManagedTransportError } from "./transport-error.js"

export function actionCapacityError(reconcileMs: number): ManagedTransportError {
  const retry = retryMetadataFor({ cause: RETRY_POLICY_CAUSE.ACTION_CAPACITY, reconcileMs })
  return new ManagedTransportError(retry.errorCode, "Managed AI action capacity is exhausted", {
    details: retry.details,
    retryAfterSeconds: retry.retryAfterSeconds,
  })
}

export function resultCapacityError(
  exhaustion: ResultCapacityExhaustion,
  nowMs: number,
  reconcileMs: number,
): ManagedTransportError {
  const retry = exhaustion.state === RESULT_RESERVATION_STATE.IN_FLIGHT
    ? retryMetadataFor({
      cause: RETRY_POLICY_CAUSE.AI_RESULT_CAPACITY,
      state: AI_RESULT_CAPACITY_STATE.IN_FLIGHT_CONTRIBUTES,
      reconcileMs,
    })
    : retryMetadataFor({
      cause: RETRY_POLICY_CAUSE.AI_RESULT_CAPACITY,
      state: AI_RESULT_CAPACITY_STATE.RETAINED_ONLY,
      nowMs,
      earliestRetainedExpiresAtMs: exhaustion.earliestRetainedExpiresAtMs,
    })
  if (retry.errorCode !== MANAGED_ERROR_CODE.MANAGED_AI_RESULT_CAPACITY) {
    throw new TypeError("AI result capacity retry policy drifted")
  }
  return new ManagedTransportError(retry.errorCode, "Managed AI result capacity is exhausted", {
    details: retry.details,
    retryAfterSeconds: retry.retryAfterSeconds,
  })
}
