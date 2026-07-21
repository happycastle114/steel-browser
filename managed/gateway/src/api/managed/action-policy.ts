import {
  AI_ACTION_REQUEST_SCHEMA,
  AUTHORIZATION_OPERATION,
  MANAGED_ERROR_CODE,
  filterAuthorizedResources,
  type AiActionRequest,
  type AuthorizationOperation,
  type PrincipalId,
} from "@happycastle/steel-managed-shared"

import type { AuthenticatedPrincipal } from "./execution-contract.js"
import { ManagedTransportError } from "./transport-error.js"

type ActionAuthorizationInput = Readonly<{
  readonly principal: AuthenticatedPrincipal
  readonly operation:
    | typeof AUTHORIZATION_OPERATION.AI_ACTION
    | typeof AUTHORIZATION_OPERATION.RESULT_DOWNLOAD
  readonly ownerId: PrincipalId
  readonly creatorId: PrincipalId
}>

export function parseAiAction(input: unknown): AiActionRequest {
  const parsed = AI_ACTION_REQUEST_SCHEMA.safeParse(input)
  if (!parsed.success) {
    throw new ManagedTransportError(
      MANAGED_ERROR_CODE.TOOL_INPUT_INVALID,
      "Tool input did not match its schema",
    )
  }
  return parsed.data
}

export function requireActionAuthorization(input: ActionAuthorizationInput): void {
  const visible = filterAuthorizedResources({
    role: input.principal.role,
    operation: input.operation,
    principalId: input.principal.principalId,
    resources: [{ ownerId: input.ownerId, creatorId: input.creatorId, resource: true }],
  })
  if (visible.length === 1) return
  throw authorizationError(input.operation)
}

function authorizationError(operation: AuthorizationOperation): ManagedTransportError {
  switch (operation) {
    case AUTHORIZATION_OPERATION.AI_ACTION:
      return new ManagedTransportError(
        MANAGED_ERROR_CODE.ACCESS_FORBIDDEN,
        "The principal cannot execute this action",
      )
    case AUTHORIZATION_OPERATION.RESULT_DOWNLOAD:
      return new ManagedTransportError(MANAGED_ERROR_CODE.RESULT_NOT_FOUND, "The result was not found")
    default:
      return new ManagedTransportError(MANAGED_ERROR_CODE.ACCESS_FORBIDDEN, "The operation is forbidden")
  }
}
