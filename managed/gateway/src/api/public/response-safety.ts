import {
  PublicHttpMethod,
  type PublicHttpResponse,
  type PublicStreamingHttpResponse,
  type PublicResponseRewriteInput,
} from "./schemas.js"
import { isManagedInternalHeader } from "./proxy-headers.js"

const CONTENT_LENGTH = "content-length"
const TRANSFER_ENCODING = "transfer-encoding"
const SENSITIVE_RESPONSE_HEADERS = new Set(["set-cookie", "www-authenticate"])

export class PublicResponseRewriteError extends Error {
  public override readonly name = "PublicResponseRewriteError"
}

export function responseHeaderValue(
  headers: PublicResponseRewriteInput["response"]["headers"],
  name: string,
): string | undefined {
  const entry = Object.entries(headers).find(
    ([headerName]) => headerName.toLowerCase() === name,
  )
  const value = entry?.[1]
  return typeof value === "string" ? value : value?.[0]
}

export function sanitizePublicResponseHeaders(
  headers: PublicResponseRewriteInput["response"]["headers"],
  input: {
    readonly bodyLength: number
    readonly method: PublicHttpMethod
    readonly statusCode: number
  },
): PublicHttpResponse["headers"] {
  const sanitized = Object.fromEntries(
    Object.entries(headers)
      .filter(([name, value]) => {
        const normalized = name.toLowerCase()
        return (
          !isManagedInternalHeader(normalized) &&
          !SENSITIVE_RESPONSE_HEADERS.has(normalized) &&
          normalized !== CONTENT_LENGTH &&
          normalized !== TRANSFER_ENCODING &&
          value !== undefined
        )
      })
      .map(([name, value]) => [name.toLowerCase(), value] as const),
  )
  const sourceLength = responseHeaderValue(headers, CONTENT_LENGTH)
  if (input.statusCode < 200 || input.statusCode === 204) return sanitized
  if (
    (input.method === PublicHttpMethod.HEAD || input.statusCode === 304) &&
    sourceLength !== undefined
  ) {
    return { ...sanitized, [CONTENT_LENGTH]: sourceLength }
  }
  if (input.statusCode === 304) return sanitized
  return { ...sanitized, [CONTENT_LENGTH]: String(input.bodyLength) }
}

export function assertPrivateOriginAbsentFromHeaders(
  headers: PublicHttpResponse["headers"],
  upstreamOrigin: string,
): void {
  const origin = new URL(upstreamOrigin)
  for (const value of Object.values(headers)) {
    const text = typeof value === "string" ? value : value?.join("\n")
    if (
      text !== undefined &&
      containsPrivateAuthority(text, origin)
    ) {
      throw new PublicResponseRewriteError("upstream response header contained a private origin")
    }
  }
}

export function containsPrivateAuthority(value: string, origin: URL): boolean {
  const normalized = value.toLowerCase()
  return [origin.hostname, origin.host]
    .map((authority) => authority.toLowerCase())
    .some((authority) => authority.length > 0 && normalized.includes(authority))
}

export function sanitizePublicStreamingHeaders(
  headers: PublicHttpResponse["headers"],
  upstreamOrigin: string,
): PublicStreamingHttpResponse["headers"] {
  const origin = new URL(upstreamOrigin)
  const sanitized = Object.fromEntries(
    Object.entries(headers).flatMap(([rawName, value]) => {
      const name = rawName.toLowerCase()
      if (
        value === undefined ||
        isManagedInternalHeader(name) ||
        SENSITIVE_RESPONSE_HEADERS.has(name) ||
        name === CONTENT_LENGTH ||
        name === TRANSFER_ENCODING
      ) return []
      const values = typeof value === "string" ? [value] : value
      if (values.some((item) => containsPrivateAuthority(item, origin))) return []
      return [[name, value] as const]
    }),
  )
  const contentType = responseHeaderValue(sanitized, "content-type")
  if (contentType?.toLowerCase().startsWith("text/event-stream") !== true) {
    throw new PublicResponseRewriteError("upstream stream was not server-sent events")
  }
  return sanitized
}
