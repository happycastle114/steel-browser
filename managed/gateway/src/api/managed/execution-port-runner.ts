import {
  MANAGED_ERROR_CODE,
  canonicalJson,
} from "@happycastle/steel-managed-shared"

import {
  ManagedExecutionCompletionSchema,
  type ControlPlaneExecutionPort,
  type ManagedExecutionCompletion,
  type ManagedExecutionInvocation,
} from "./execution-contract.js"
import { ManagedTransportError } from "./transport-error.js"

export async function executeControlPlaneAction(
  port: ControlPlaneExecutionPort,
  invocation: ManagedExecutionInvocation,
): Promise<ManagedExecutionCompletion> {
  const raw = await awaitExecution(port.execute(invocation), invocation.signal)
  const completion = ManagedExecutionCompletionSchema.safeParse(raw)
  if (!completion.success || completion.data.resultId !== invocation.resultId ||
    canonicalJson(completion.data.action) !== canonicalJson(invocation.action)) {
    throw new ManagedTransportError(
      MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE,
      "The control plane returned an invalid response",
    )
  }
  return completion.data
}

function awaitExecution(execution: Promise<unknown>, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", onAbort)
      callback()
    }
    const onAbort = (): void => {
      finish(() => reject(new ManagedTransportError(
        MANAGED_ERROR_CODE.TOOL_TIMEOUT,
        "Tool execution timed out",
      )))
    }
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) onAbort()
    execution.then(
      (value) => finish(() => resolve(value)),
      () => finish(() => reject(new ManagedTransportError(
        MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE,
        "The control plane execution failed",
      ))),
    )
  })
}
