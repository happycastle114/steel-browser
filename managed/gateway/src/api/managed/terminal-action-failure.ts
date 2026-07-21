import {
  MANAGED_ERROR_CODE,
  type ManagedErrorCode,
} from "@happycastle/steel-managed-shared"

import { ManagedTransportError } from "./transport-error.js"

export const TERMINAL_ACTION_ERROR_CODE = {
  ACCESS_FORBIDDEN: MANAGED_ERROR_CODE.ACCESS_FORBIDDEN,
  RESULT_TOO_LARGE: MANAGED_ERROR_CODE.RESULT_TOO_LARGE,
  UPSTREAM_BAD_RESPONSE: MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE,
  MANAGER_DRAINING: MANAGED_ERROR_CODE.MANAGER_DRAINING,
  TOOL_TIMEOUT: MANAGED_ERROR_CODE.TOOL_TIMEOUT,
} as const

export type TerminalActionErrorCode =
  (typeof TERMINAL_ACTION_ERROR_CODE)[keyof typeof TERMINAL_ACTION_ERROR_CODE]

const TERMINAL_ACTION_ERROR_MESSAGE = {
  [TERMINAL_ACTION_ERROR_CODE.ACCESS_FORBIDDEN]: "The principal cannot execute this action",
  [TERMINAL_ACTION_ERROR_CODE.RESULT_TOO_LARGE]: "The tool result exceeds the configured limit",
  [TERMINAL_ACTION_ERROR_CODE.UPSTREAM_BAD_RESPONSE]: "The control plane returned an invalid response",
  [TERMINAL_ACTION_ERROR_CODE.MANAGER_DRAINING]: "Managed AI service is closing",
  [TERMINAL_ACTION_ERROR_CODE.TOOL_TIMEOUT]: "Tool execution timed out",
} as const satisfies Readonly<Record<TerminalActionErrorCode, string>>

export class TerminalActionError extends ManagedTransportError {
  public constructor(public override readonly code: TerminalActionErrorCode) {
    super(code, TERMINAL_ACTION_ERROR_MESSAGE[code])
  }
}

export function normalizeTerminalActionError(error: unknown): TerminalActionError {
  if (error instanceof ManagedTransportError && isTerminalActionErrorCode(error.code)) {
    return terminalActionError(error.code)
  }
  return terminalActionError(TERMINAL_ACTION_ERROR_CODE.UPSTREAM_BAD_RESPONSE)
}

export function terminalActionError(code: TerminalActionErrorCode): TerminalActionError {
  return new TerminalActionError(code)
}

function isTerminalActionErrorCode(code: ManagedErrorCode): code is TerminalActionErrorCode {
  switch (code) {
    case TERMINAL_ACTION_ERROR_CODE.ACCESS_FORBIDDEN:
    case TERMINAL_ACTION_ERROR_CODE.RESULT_TOO_LARGE:
    case TERMINAL_ACTION_ERROR_CODE.UPSTREAM_BAD_RESPONSE:
    case TERMINAL_ACTION_ERROR_CODE.MANAGER_DRAINING:
    case TERMINAL_ACTION_ERROR_CODE.TOOL_TIMEOUT:
      return true
    default:
      return false
  }
}
