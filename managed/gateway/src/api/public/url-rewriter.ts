import { assertNever } from "../../domain/exhaustive.js"
import {
  PublicHttpMethod,
  type PublicHttpResponse,
  type PublicResponseRewriteInput,
} from "./schemas.js"
import {
  PublicResponseRewriteError,
  assertPrivateOriginAbsentFromHeaders,
  responseHeaderValue,
  sanitizePublicResponseHeaders,
} from "./response-safety.js"
import {
  PublicUrlTransformError,
  rewriteTypedHeaders,
  rewriteTypedTextBody,
} from "./url-rewrite-transforms.js"
import {
  PublicBodyRewriteKind,
  publicBodyRewriteKind,
} from "./response-body-rewrite-policy.js"
import { rewriteJsonBody } from "./session-response-rewriter.js"

const CONTENT_TYPE = "content-type"
const JSON_CONTENT_TYPE = "application/json"
const SUCCESS_STATUS_MINIMUM = 200
const SUCCESS_STATUS_MAXIMUM = 300
const ERROR_STATUS_MINIMUM = 400

export { PublicResponseRewriteError } from "./response-safety.js"

export function rewritePublicResponse(input: PublicResponseRewriteInput): PublicHttpResponse {
  const mediaType = responseHeaderValue(input.response.headers, CONTENT_TYPE)
  let body: Buffer
  try {
    if (!responseBodyAllowed(input)) {
      body = Buffer.alloc(0)
    } else if (!rewriteSuccessfulBody(input)) {
      body = input.response.body
    } else {
      const kind = publicBodyRewriteKind(input.routeId)
      switch (kind) {
        case PublicBodyRewriteKind.JSON:
          if (mediaType?.toLowerCase().startsWith(JSON_CONTENT_TYPE) !== true) {
            throw new PublicResponseRewriteError("upstream response content type was invalid")
          }
          body = Buffer.from(JSON.stringify(
            rewriteJsonBody(input, JSON.parse(input.response.body.toString("utf8"))),
          ))
          break
        case PublicBodyRewriteKind.TEXT:
          body = rewriteTypedTextBody(input)
          break
        case PublicBodyRewriteKind.PASSTHROUGH:
          body = input.response.body
          break
        default:
          body = assertNever(kind)
      }
    }
  } catch (error) {
    const message = error instanceof PublicUrlTransformError
      ? error.message
      : "upstream response did not match the public contract"
    throw new PublicResponseRewriteError(message, errorOptions(error))
  }
  const sourceHeaders = input.response.statusCode >= ERROR_STATUS_MINIMUM
    ? input.response.headers
    : rewriteTypedHeaders(input)
  const headers = sanitizePublicResponseHeaders(sourceHeaders, {
    bodyLength: body.byteLength,
    method: input.requestMethod,
    statusCode: input.response.statusCode,
  })
  assertPrivateOriginAbsentFromHeaders(headers, input.upstreamOrigin)
  return {
    statusCode: input.response.statusCode,
    headers,
    body,
  }
}

function rewriteSuccessfulBody(input: PublicResponseRewriteInput): boolean {
  return (
    input.response.statusCode >= SUCCESS_STATUS_MINIMUM &&
    input.response.statusCode < SUCCESS_STATUS_MAXIMUM &&
    input.requestMethod !== PublicHttpMethod.HEAD &&
    input.response.body.byteLength > 0 &&
    publicBodyRewriteKind(input.routeId) !== PublicBodyRewriteKind.PASSTHROUGH
  )
}

function responseBodyAllowed(input: PublicResponseRewriteInput): boolean {
  return (
    input.requestMethod !== PublicHttpMethod.HEAD &&
    input.response.statusCode >= 200 &&
    input.response.statusCode !== 204 &&
    input.response.statusCode !== 304
  )
}

function errorOptions(error: unknown): ErrorOptions | undefined {
  return error instanceof Error ? { cause: error } : undefined
}
