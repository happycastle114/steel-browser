import {
  HTTP_RESPONSE_HEADER,
  HTTP_SUCCESS_STATUS,
  AiResultPendingOutcomeSchema,
  createAiActionAcceptedOutcomeSchema,
  createAiResultCompletedOutcomeSchema,
  createToolDefinitionRegistry,
  createToolResultSchemas,
  type AiActionAcceptedBody,
  type AiActionRequest,
  type ResultId,
  type SelectedPublicOrigin,
  type StructuralCapabilities,
} from "@happycastle/steel-managed-shared/ai-client"

import type { AiResultRead } from "./client-types.js"
import { AiClientProtocolError, throwApiOrProtocolError } from "./errors.js"
import type { AiFetchResponse } from "./fetch-contract.js"
import { bindResultIdentity } from "./identity-binding.js"

const MEDIA_TYPE = Object.freeze({ JSON: "application/json" })

async function json(response: AiFetchResponse): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new AiClientProtocolError("Managed AI API returned malformed JSON")
  }
}

export async function readSuccessJson(response: AiFetchResponse): Promise<unknown> {
  const payload = await json(response)
  if (!response.ok) await throwApiOrProtocolError(response.status, payload)
  return payload
}

export async function readAccepted(
  response: AiFetchResponse,
  selectedOrigin: SelectedPublicOrigin,
): Promise<AiActionAcceptedBody> {
  const body = await readSuccessJson(response)
  const parsed = createAiActionAcceptedOutcomeSchema(selectedOrigin).safeParse({
    status: response.status,
    headers: {
      [HTTP_RESPONSE_HEADER.LOCATION]: response.headers.get(HTTP_RESPONSE_HEADER.LOCATION) ?? "",
      [HTTP_RESPONSE_HEADER.RETRY_AFTER]: response.headers.get(HTTP_RESPONSE_HEADER.RETRY_AFTER) ?? "",
    },
    body,
  })
  if (!parsed.success) throw new AiClientProtocolError("Managed AI API returned an invalid action outcome")
  return parsed.data.body
}

function transport(capabilities: StructuralCapabilities) {
  return {
    httpBodyBytes: capabilities.limits.httpBodyBytes,
    textBytes: capabilities.limits.textBytes,
    binaryBytes: capabilities.limits.binaryBytes,
    resultBytes: capabilities.limits.resultBytes,
  }
}

function mediaType(response: AiFetchResponse): string {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? ""
}

export async function readResult(
  response: AiFetchResponse,
  resultId: ResultId,
  action: AiActionRequest,
  selectedOrigin: SelectedPublicOrigin,
  capabilities: StructuralCapabilities,
): Promise<AiResultRead> {
  if (!response.ok) await throwApiOrProtocolError(response.status, await json(response))
  if (response.status === HTTP_SUCCESS_STATUS.ACCEPTED) {
    const parsed = AiResultPendingOutcomeSchema.safeParse({
      status: response.status,
      headers: { [HTTP_RESPONSE_HEADER.RETRY_AFTER]: response.headers.get(HTTP_RESPONSE_HEADER.RETRY_AFTER) ?? "" },
      body: await json(response),
    })
    if (!parsed.success || parsed.data.body.resultId !== resultId) {
      throw new AiClientProtocolError("Managed AI API returned an invalid pending result")
    }
    return parsed.data.body
  }
  if (response.status !== HTTP_SUCCESS_STATUS.OK) {
    throw new AiClientProtocolError("Managed AI API returned an unexpected success status")
  }
  if (mediaType(response) !== MEDIA_TYPE.JSON) {
    throw new AiClientProtocolError("Managed AI API did not return the retained result descriptor")
  }
  const schemas = createToolResultSchemas(selectedOrigin, transport(capabilities))
  const parsed = createAiResultCompletedOutcomeSchema(schemas.ManagedToolResultSchema).safeParse({
    status: response.status,
    headers: {},
    body: await json(response),
  })
  if (!parsed.success || parsed.data.body.resultId !== resultId) {
    throw new AiClientProtocolError("Managed AI API returned an invalid completed result")
  }
  const definition = createToolDefinitionRegistry(selectedOrigin, transport(capabilities))[action.tool.name]
  if (!definition.outputSchema.safeParse(parsed.data.body.result).success) {
    throw new AiClientProtocolError("Managed AI API returned a result for a different tool")
  }
  bindResultIdentity(action, parsed.data.body.result)
  return parsed.data.body
}
