import { z } from "zod"
import { zodToJsonSchema } from "zod-to-json-schema"

import { JsonValueSchema, type JsonValue } from "./canonical-json.js"
import type { ManagedTransportConfig } from "./managed-transport-config.js"
import type { SelectedPublicOrigin } from "./public-urls.js"
import { TOOL_NAMES, createToolDefinitionRegistry } from "./tool-registry.js"

function containsReference(value: JsonValue): boolean {
  if (Array.isArray(value)) return value.some(containsReference)
  if (value === null || typeof value !== "object") return false
  return Object.entries(value).some(([key, nested]) => key === "$ref" || containsReference(nested))
}

function deepFreezeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return Object.freeze(value.map(deepFreezeJson))
  if (value === null || typeof value !== "object") return value
  const frozenEntries: Record<string, JsonValue> = {}
  for (const [key, nested] of Object.entries(value)) frozenEntries[key] = deepFreezeJson(nested)
  return Object.freeze(frozenEntries)
}

function isJsonArray(value: JsonValue | undefined): value is readonly JsonValue[] {
  return Array.isArray(value)
}

function isJsonObject(value: JsonValue | undefined): value is Readonly<Record<string, JsonValue>> {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)
}

function requireRootObjectSchema(value: JsonValue): JsonValue {
  if (!isJsonObject(value)) {
    throw new TypeError("canonical tool schema root must be an object")
  }
  if (value["type"] === "object") return value
  const variants = value["anyOf"]
  if (!isJsonArray(variants) || variants.length === 0 || variants.some((entry) =>
    !isJsonObject(entry) || entry["type"] !== "object")) {
    throw new TypeError("canonical tool schema root must describe object output")
  }
  return { ...value, type: "object" }
}

function jsonSchemaFor<Schema extends z.ZodType>(schema: Schema): JsonValue {
  const generated = requireRootObjectSchema(JsonValueSchema.parse(zodToJsonSchema(schema, {
    $refStrategy: "none",
    target: "jsonSchema7",
  })))
  if (containsReference(generated)) throw new TypeError("canonical tool schemas must be dereferenced")
  return deepFreezeJson(generated)
}

export type ToolSchemaArtifactConfig = Readonly<{
  readonly selectedOrigin: SelectedPublicOrigin
  readonly transport: ManagedTransportConfig
}>

export function createToolSchemaArtifacts(input: ToolSchemaArtifactConfig) {
  const definitionRegistry = createToolDefinitionRegistry(input.selectedOrigin, input.transport)
  const schemaArtifacts = Object.freeze(TOOL_NAMES.map((name) => {
    const definition = definitionRegistry[name]
    return Object.freeze({
      name,
      version: definition.version,
      mutability: definition.mutability,
      sessionRequirement: definition.sessionRequirement,
      inputSchema: jsonSchemaFor(definition.inputSchema),
      outputSchema: jsonSchemaFor(definition.outputSchema),
    })
  }))
  return Object.freeze({ definitionRegistry, schemaArtifacts })
}
