/* This file is generated from the shared AI route registry. Do not edit. */
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

export const AI_CLIENT_ROUTE_INVENTORY = Object.freeze([{"method":"GET","path":"/v1/capabilities","successStatus":200},{"method":"GET","path":"/v1/tools","successStatus":200},{"method":"POST","path":"/v1/actions","successStatus":202},{"method":"GET","path":"/v1/results/:id","successStatus":[200,202]}])
