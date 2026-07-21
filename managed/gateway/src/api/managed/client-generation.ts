import {
  AI_ROUTE_REGISTRY,
  ROUTE_RESPONSE_KIND,
  type RouteResponseContract,
} from "@happycastle/steel-managed-shared"
import { assertNever } from "../../domain/exhaustive.js"

function successStatus(response: RouteResponseContract): number | readonly number[] {
  switch (response.kind) {
    case ROUTE_RESPONSE_KIND.FIXED:
      return response.status
    case ROUTE_RESPONSE_KIND.ASYNC_ACTION:
      return response.accepted.status
    case ROUTE_RESPONSE_KIND.ASYNC_RESULT:
      return Object.freeze([response.completed.status, response.pending.status].sort((left, right) => left - right))
    default:
      return assertNever(response)
  }
}

export function renderGeneratedAiClientContract(): string {
  const inventory = AI_ROUTE_REGISTRY.map((route) => Object.freeze({
    method: route.method,
    path: route.path,
    successStatus: successStatus(route.response),
  }))
  return `/* This file is generated from the shared AI route registry. Do not edit. */
import {
  AI_ROUTE_PATH,
  type ResultId,
} from "@happycastle/steel-managed-shared/ai-client"

const RESULT_PREFIX = AI_ROUTE_PATH.RESULT.replace(/:id$/u, "")

export const AI_CLIENT_ROUTE = Object.freeze({
  CAPABILITIES: AI_ROUTE_PATH.CAPABILITIES,
  TOOLS: AI_ROUTE_PATH.TOOLS,
  ACTIONS: AI_ROUTE_PATH.ACTIONS,
  RESULT: (resultId: ResultId): string => RESULT_PREFIX + encodeURIComponent(resultId),
})

export const AI_CLIENT_ROUTE_INVENTORY = Object.freeze(${JSON.stringify(inventory)})
`
}
