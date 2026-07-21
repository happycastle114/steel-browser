import type { IncomingHttpHeaders } from "node:http"
import {
  normalizeCreateReplay,
  UnrepresentableCreateReplayError,
  type CreateReplay,
} from "@happycastle/steel-managed-shared"

export { UnrepresentableCreateReplayError }

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  return typeof value === "string" ? value : undefined
}

function retryAfterSeconds(headers: IncomingHttpHeaders): number | undefined {
  const value = headerValue(headers, "retry-after")
  if (value === undefined) return undefined
  if (!/^[1-9][0-9]*$/u.test(value)) throw new UnrepresentableCreateReplayError()
  return Number(value)
}

export function buildCreateReplay(
  status: number,
  headers: IncomingHttpHeaders,
  bytes: Buffer,
): { readonly replay: CreateReplay; readonly sessionId?: string } {
  const contentType = headerValue(headers, "content-type")
  if (contentType === undefined || !/^application\/json(?:;|$)/iu.test(contentType)) {
    throw new UnrepresentableCreateReplayError()
  }
  let body: unknown
  try {
    body = JSON.parse(bytes.toString("utf8"))
  } catch {
    throw new UnrepresentableCreateReplayError()
  }
  const location = headerValue(headers, "location")
  const retryAfter = retryAfterSeconds(headers)
  return normalizeCreateReplay({
    body,
    contentType,
    ...(location === undefined ? {} : { location }),
    ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter }),
    status,
  })
}
