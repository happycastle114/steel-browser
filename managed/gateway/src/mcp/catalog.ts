import {
  JsonValueSchema,
  TOOL_MUTABILITY,
  ToolSchemaDescriptorSchema,
  type JsonValue,
  type ToolName,
} from "@happycastle/steel-managed-shared"
import { z } from "zod"

export type McpToolDescriptor = Readonly<{
  readonly name: ToolName
  readonly inputSchema: Readonly<Record<string, JsonValue>>
  readonly outputSchema: Readonly<Record<string, JsonValue>>
  readonly annotations: Readonly<{ readonly readOnlyHint: boolean }>
  readonly _meta: Readonly<{
    readonly inputSchemaSha256: string
    readonly outputSchemaSha256: string
    readonly version: string
  }>
}>

export function createMcpToolCatalog(
  descriptors: readonly z.input<typeof ToolSchemaDescriptorSchema>[],
): readonly McpToolDescriptor[] {
  return Object.freeze(descriptors.map((tool) => Object.freeze({
    name: tool.name,
    inputSchema: jsonObject(tool.inputSchema),
    outputSchema: jsonObject(tool.outputSchema),
    annotations: Object.freeze({ readOnlyHint: tool.mutability === TOOL_MUTABILITY.READ }),
    _meta: Object.freeze({
      inputSchemaSha256: tool.inputSchemaSha256,
      outputSchemaSha256: tool.outputSchemaSha256,
      version: tool.version,
    }),
  })))
}

function jsonObject(value: JsonValue): Readonly<Record<string, JsonValue>> {
  return z.record(JsonValueSchema).parse(value)
}
