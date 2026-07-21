import {
  AI_ASYNC_OUTCOME_STATE,
  type BinaryResult,
} from "@happycastle/steel-managed-shared/ai-client"

import type { AiBinaryDownload } from "./client-types.js"
import { AiClientProtocolError, throwApiOrProtocolError } from "./errors.js"
import type { AiFetch, AiFetchRequest, AiFetchResponse } from "./fetch-contract.js"

type BinaryDownloadInput = Readonly<{
  readonly fetch: AiFetch
  readonly request: AiFetchRequest
  readonly response?: AiFetchResponse
  readonly result: BinaryResult
  readonly maximumBytes: number
}>

export async function downloadBinary(input: BinaryDownloadInput): Promise<AiBinaryDownload> {
  const response = input.response ?? await input.fetch(input.result.downloadUrl, input.request)
  if (!response.ok) await throwApiOrProtocolError(response.status, await safeJson(response))
  if (response.status !== 200) throw new AiClientProtocolError("Binary result returned an unexpected success status")
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? ""
  if (contentType !== input.result.contentType) {
    throw new AiClientProtocolError("Binary result media type differs from its retained descriptor")
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  const claimedLength = response.headers.get("content-length")
  if (bytes.byteLength > input.maximumBytes || bytes.byteLength !== input.result.byteLength ||
    (claimedLength !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(claimedLength) || Number(claimedLength) !== bytes.byteLength))) {
    throw new AiClientProtocolError("Binary result length differs from its retained descriptor")
  }
  if (await sha256(bytes) !== input.result.sha256) {
    throw new AiClientProtocolError("Binary result digest differs from its retained descriptor")
  }
  return Object.freeze({
    state: AI_ASYNC_OUTCOME_STATE.COMPLETED,
    resultId: input.result.resultId,
    result: input.result,
    contentType,
    bytes,
  })
}

async function sha256(bytes: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle === undefined) {
    throw new AiClientProtocolError("Web Crypto is required to validate binary results")
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function safeJson(response: AiFetchResponse): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new AiClientProtocolError("Managed AI API returned an invalid binary error response")
  }
}
