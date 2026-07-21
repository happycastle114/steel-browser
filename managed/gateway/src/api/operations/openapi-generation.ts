import {
  CONTROL_PLANE_API_VERSION,
  MANAGED_ERROR_CATALOG,
  MANAGED_ERROR_CODE,
} from "@happycastle/steel-managed-shared";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  MANAGED_OPENAPI_COMPONENT,
  MANAGED_OPENAPI_OPERATIONS,
  MANAGED_OPENAPI_SCHEMAS,
  type ManagedOpenApiOperation,
} from "./openapi-contract.js";

const JSON_MEDIA_TYPE = "application/json";
const EVENT_SEQUENCE_PATTERN = "^[1-9][0-9]{0,19}$";

function schemaReference(name: string) {
  return { $ref: `#/components/schemas/${name}` };
}

function responseHeaders() {
  return {
    "X-Managed-Api-Version": {
      required: true,
      schema: { type: "string", enum: [CONTROL_PLANE_API_VERSION] },
    },
  };
}

function errorSchema(operation: ManagedOpenApiOperation, status: number) {
  const codes = operation.errorCodes.filter(
    (code) => MANAGED_ERROR_CATALOG[code].status === status,
  );
  return {
    allOf: [
      schemaReference(MANAGED_OPENAPI_COMPONENT.MANAGED_ERROR),
      {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: { code: { type: "string", enum: codes } },
          },
        },
      },
    ],
  };
}

function responses(operation: ManagedOpenApiOperation) {
  const result: Record<string, unknown> = {
    [operation.successStatus]: {
      description: "Successful managed operation",
      headers: responseHeaders(),
      content: {
        [JSON_MEDIA_TYPE]: {
          schema: schemaReference(operation.responseComponent),
        },
      },
    },
  };
  for (const status of operation.errorStatuses) {
    result[status] = {
      description: `Managed error (${status})`,
      headers: responseHeaders(),
      content: {
        [JSON_MEDIA_TYPE]: { schema: errorSchema(operation, status) },
      },
    };
  }
  return result;
}

function requestBody(component: string) {
  return {
    required: true,
    content: {
      [JSON_MEDIA_TYPE]: { schema: schemaReference(component) },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bindEventSequencePattern(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(bindEventSequencePattern);
  if (!isRecord(value)) return value;
  const mapped = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      bindEventSequencePattern(child),
    ]),
  );
  const properties = mapped["properties"];
  if (!isRecord(properties) || !isRecord(properties["sequence"])) return mapped;
  return {
    ...mapped,
    properties: {
      ...properties,
      sequence: { ...properties["sequence"], pattern: EVENT_SEQUENCE_PATTERN },
    },
  };
}

function operationDocument(operation: ManagedOpenApiOperation) {
  return {
    operationId: operation.operationId,
    tags: ["Managed operations"],
    security: [{ cloudflareAccess: [] }],
    parameters: operation.parameters,
    ...(operation.requestComponent === undefined
      ? {}
      : { requestBody: requestBody(operation.requestComponent) }),
    responses: responses(operation),
  };
}

function openApiPaths() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of MANAGED_OPENAPI_OPERATIONS) {
    const path = operation.path.replace(":id", "{id}");
    const current = paths[path] ?? {};
    paths[path] = {
      ...current,
      [operation.method.toLowerCase()]: operationDocument(operation),
    };
  }
  return paths;
}

function openApiSchemas() {
  const generated = Object.fromEntries(
    Object.entries(MANAGED_OPENAPI_SCHEMAS)
      .filter(([name]) => name !== MANAGED_OPENAPI_COMPONENT.MANAGED_ERROR)
      .map(([name, schema]) => {
        const generatedSchema = zodToJsonSchema(schema, {
          target: "openApi3",
          $refStrategy: "none",
        });
        return [
          name,
          name === MANAGED_OPENAPI_COMPONENT.EVENT_LIST
            ? bindEventSequencePattern(generatedSchema)
            : generatedSchema,
        ];
      }),
  );
  return {
    ...generated,
    JsonValue: {
      oneOf: [
        { enum: [null] },
        { type: "boolean" },
        { type: "number" },
        { type: "string" },
        { type: "array", items: schemaReference("JsonValue") },
        { type: "object", additionalProperties: schemaReference("JsonValue") },
      ],
    },
    [MANAGED_OPENAPI_COMPONENT.MANAGED_ERROR]: {
      type: "object",
      additionalProperties: false,
      required: ["apiVersion", "error"],
      properties: {
        apiVersion: { type: "string", enum: [CONTROL_PLANE_API_VERSION] },
        error: {
          type: "object",
          additionalProperties: false,
          required: ["code", "message", "retryable", "requestId"],
          properties: {
            code: { type: "string", enum: Object.values(MANAGED_ERROR_CODE) },
            message: { type: "string", minLength: 1, maxLength: 1_024 },
            retryable: { type: "boolean" },
            requestId: { type: "string", format: "uuid" },
            details: schemaReference("JsonValue"),
          },
        },
      },
    },
  };
}

export function createManagedOpenApiDocument() {
  return {
    openapi: "3.0.3",
    info: {
      title: "Steel Managed Operations API",
      version: CONTROL_PLANE_API_VERSION,
      license: { name: "Apache-2.0" },
    },
    servers: [{ url: "/" }],
    paths: openApiPaths(),
    components: {
      securitySchemes: {
        cloudflareAccess: {
          type: "apiKey",
          in: "header",
          name: "Cf-Access-Jwt-Assertion",
        },
      },
      schemas: openApiSchemas(),
    },
  };
}

export function renderManagedOpenApi(): string {
  return `${JSON.stringify(createManagedOpenApiDocument(), undefined, 2)}\n`;
}
