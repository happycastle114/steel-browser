import {
  AI_ASYNC_OUTCOME_STATE,
  CONTROL_PLANE_API_VERSION,
  HTTP_RESPONSE_HEADER,
  HTTP_SUCCESS_STATUS,
  JsonValueSchema,
  MANAGED_ERROR_CATALOG,
  TOOL_NAMES,
} from "@happycastle/steel-managed-shared"
import { zodToJsonSchema } from "zod-to-json-schema"

import { assertNever } from "../../domain/exhaustive.js"
import {
  AI_OPENAPI_COMPONENT,
  AI_OPENAPI_OPERATIONS,
  AI_OPENAPI_OPERATION_KIND,
  AI_OPENAPI_SCHEMAS,
  type AiOpenApiOperation,
} from "./openapi-contract.js"

const MEDIA_TYPE = Object.freeze({ JSON: "application/json", JPEG: "image/jpeg", PNG: "image/png" })
const HEADER = Object.freeze({ REQUEST_ID: "X-Request-Id", CORRELATION_ID: "X-Correlation-Id" })

function reference(name: string): Readonly<{ readonly $ref: string }> {
  return { $ref: `#/components/schemas/${name}` }
}

function identityHeaders() {
  return {
    [HEADER.REQUEST_ID]: { required: true, schema: { type: "string", format: "uuid" } },
    [HEADER.CORRELATION_ID]: { required: true, schema: { type: "string", format: "uuid" } },
  }
}

function retryHeaders(includeLocation: boolean) {
  return {
    ...identityHeaders(),
    [HTTP_RESPONSE_HEADER.RETRY_AFTER]: { required: true, schema: { type: "string", pattern: "^[1-9][0-9]*$" } },
    ...(includeLocation ? {
      [HTTP_RESPONSE_HEADER.LOCATION]: { required: true, schema: { type: "string", format: "uri" } },
    } : {}),
  }
}

function jsonResponse(component: string, headers = identityHeaders()) {
  return {
    description: "Successful managed AI operation",
    headers,
    content: { [MEDIA_TYPE.JSON]: { schema: reference(component) } },
  }
}

function errorResponse(operation: AiOpenApiOperation, status: number) {
  const codes = operation.errorCodes.filter((code) => MANAGED_ERROR_CATALOG[code].status === status)
  const headers = codes.some((code) => MANAGED_ERROR_CATALOG[code].retryable)
    ? retryHeaders(false)
    : identityHeaders()
  return {
    description: `Managed AI error (${status})`,
    headers,
    content: {
      [MEDIA_TYPE.JSON]: {
        schema: {
          allOf: [
            reference(AI_OPENAPI_COMPONENT.ERROR),
            { type: "object", properties: { error: { type: "object", properties: { code: { enum: codes } } } } },
          ],
        },
      },
    },
  }
}

function successResponses(operation: AiOpenApiOperation): Record<string, unknown> {
  switch (operation.kind) {
    case AI_OPENAPI_OPERATION_KIND.CAPABILITIES:
      return { [HTTP_SUCCESS_STATUS.OK]: jsonResponse(AI_OPENAPI_COMPONENT.CAPABILITIES) }
    case AI_OPENAPI_OPERATION_KIND.TOOLS:
      return { [HTTP_SUCCESS_STATUS.OK]: jsonResponse(AI_OPENAPI_COMPONENT.TOOL_PAGE) }
    case AI_OPENAPI_OPERATION_KIND.ACTION:
      return { [HTTP_SUCCESS_STATUS.ACCEPTED]: jsonResponse(AI_OPENAPI_COMPONENT.ACTION_ACCEPTED, retryHeaders(true)) }
    case AI_OPENAPI_OPERATION_KIND.RESULT:
      return {
        [HTTP_SUCCESS_STATUS.OK]: {
          description: "Completed managed AI result",
          headers: identityHeaders(),
          content: {
            [MEDIA_TYPE.JSON]: { schema: reference(AI_OPENAPI_COMPONENT.RESULT_COMPLETED) },
            [MEDIA_TYPE.PNG]: { schema: { type: "string", format: "binary" } },
            [MEDIA_TYPE.JPEG]: { schema: { type: "string", format: "binary" } },
          },
        },
        [HTTP_SUCCESS_STATUS.ACCEPTED]: jsonResponse(AI_OPENAPI_COMPONENT.RESULT_PENDING, retryHeaders(false)),
      }
    default:
      return assertNever(operation.kind)
  }
}

function operationDocument(operation: AiOpenApiOperation) {
  const responses = successResponses(operation)
  for (const status of operation.errorStatuses) responses[String(status)] = errorResponse(operation, status)
  return {
    operationId: operation.operationId,
    tags: ["Managed AI"],
    security: [{ cloudflareAccess: [] }],
    ...(operation.kind === AI_OPENAPI_OPERATION_KIND.TOOLS ? {
      parameters: [
        { in: "query", name: "pageSize", required: false, schema: { type: "integer", minimum: 1, maximum: TOOL_NAMES.length } },
        { in: "query", name: "cursor", required: false, schema: { type: "string" } },
      ],
    } : {}),
    ...(operation.kind === AI_OPENAPI_OPERATION_KIND.RESULT ? {
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } }],
    } : {}),
    ...(operation.kind === AI_OPENAPI_OPERATION_KIND.ACTION ? {
      requestBody: { required: true, content: { [MEDIA_TYPE.JSON]: { schema: reference(AI_OPENAPI_COMPONENT.ACTION_REQUEST) } } },
    } : {}),
    responses,
  }
}

function paths() {
  const result: Record<string, Record<string, unknown>> = {}
  for (const operation of AI_OPENAPI_OPERATIONS) {
    const path = operation.path.replace(":id", "{id}")
    result[path] = { ...(result[path] ?? {}), [operation.method.toLowerCase()]: operationDocument(operation) }
  }
  return result
}

function schemas() {
  const generated = Object.fromEntries(Object.entries(AI_OPENAPI_SCHEMAS).map(([name, schema]) => [
    name,
    prefixLocalReferences(
      JsonValueSchema.parse(JSON.parse(JSON.stringify(
        zodToJsonSchema(schema, { target: "openApi3", $refStrategy: "root" }),
      ))),
      `#/components/schemas/${name}`,
    ),
  ]))
  return {
    ...generated,
    [AI_OPENAPI_COMPONENT.RESULT_COMPLETED]: {
      type: "object",
      additionalProperties: false,
      required: ["apiVersion", "resultId", "state", "result", "requestId", "correlationId"],
      properties: {
        apiVersion: { enum: [CONTROL_PLANE_API_VERSION] },
        resultId: { type: "string", format: "uuid" },
        state: { enum: [AI_ASYNC_OUTCOME_STATE.COMPLETED] },
        result: { type: "object", description: "Exact schema is advertised by /v1/tools" },
        requestId: { type: "string", format: "uuid" },
        correlationId: { type: "string", format: "uuid" },
      },
    },
  }
}

function prefixLocalReferences(value: ReturnType<typeof JsonValueSchema.parse>, prefix: string): ReturnType<typeof JsonValueSchema.parse> {
  if (Array.isArray(value)) return value.map((nested) => prefixLocalReferences(nested, prefix))
  if (value === null || typeof value !== "object") return value
  const rewritten: Record<string, ReturnType<typeof JsonValueSchema.parse>> = {}
  for (const [key, nested] of Object.entries(value)) {
    if (key === "$ref" && typeof nested === "string" && nested.startsWith("#")) {
      rewritten[key] = `${prefix}${nested.slice(1)}`
    } else {
      rewritten[key] = prefixLocalReferences(nested, prefix)
    }
  }
  return rewritten
}

export function createAiOpenApiDocument() {
  return {
    openapi: "3.0.3",
    info: { title: "Steel Managed AI API", version: CONTROL_PLANE_API_VERSION, license: { name: "Apache-2.0" } },
    servers: [{ url: "/" }],
    paths: paths(),
    components: {
      securitySchemes: { cloudflareAccess: { type: "apiKey", in: "header", name: "Cf-Access-Jwt-Assertion" } },
      schemas: schemas(),
    },
  }
}

export function renderAiOpenApi(): string {
  return `${JSON.stringify(createAiOpenApiDocument(), undefined, 2)}\n`
}
