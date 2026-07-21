import { z } from "zod"

import {
  CONTROL_PLANE_SERVICE_NAME,
  ControlPlaneApiVersionSchema,
  MCP_PROTOCOL_VERSION,
  ToolVersionSchema,
} from "./control-plane-contract.js"
import { ByteCountSchema, SafeCountSchema, Sha256Schema } from "./control-plane-primitives.js"
import { ManagedTransportConfigSchema } from "./managed-transport-config.js"
import { withDeepFrozenOutput } from "./deep-readonly.js"
import { ToolMutabilitySchema, ToolSessionRequirementSchema } from "./control-plane-vocabulary-schemas.js"
import { JsonValueSchema } from "./json-value.js"
import { TOOL_NAMES, TOOL_VERSION, type ToolName } from "./tool-registry.js"

export const ToolNameSchema = z.enum(TOOL_NAMES)
export const ToolDescriptorSchema = z.object({
  name: ToolNameSchema,
  version: z.literal(TOOL_VERSION),
  mutability: ToolMutabilitySchema,
  sessionRequirement: ToolSessionRequirementSchema,
  inputSchemaSha256: Sha256Schema,
  outputSchemaSha256: Sha256Schema,
}).strict()

export const ToolSchemaDescriptorSchema = ToolDescriptorSchema.extend({
  inputSchema: JsonValueSchema,
  outputSchema: JsonValueSchema,
}).strict()

export const CapabilityLimitsSchema = ManagedTransportConfigSchema.extend({
  httpHeaderBytes: ByteCountSchema,
  httpConnectionCount: SafeCountSchema,
  httpConnectionReservedBytes: ByteCountSchema,
  httpBodyCount: SafeCountSchema,
  httpBodyReservedBytes: ByteCountSchema,
  resultCount: SafeCountSchema,
  actionTimeoutMs: SafeCountSchema,
  actionCount: SafeCountSchema,
  webSocketCount: SafeCountSchema,
  webSocketReservedBytes: ByteCountSchema,
}).strict()

function requireExactToolNames(
  tools: readonly Readonly<{ readonly name: ToolName }>[],
  context: z.RefinementCtx,
): void {
  for (const [index, expectedName] of TOOL_NAMES.entries()) {
    if (tools[index]?.name !== expectedName) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "capability tools must match the canonical registry" })
      return
    }
  }
}

const CapabilityToolListSchema = z.array(ToolDescriptorSchema).length(TOOL_NAMES.length)
  .superRefine(requireExactToolNames)
const ToolSchemaDescriptorListSchema = z.array(ToolSchemaDescriptorSchema).length(TOOL_NAMES.length)
  .superRefine(requireExactToolNames)
const CapabilityResponseShape = {
  apiVersion: ControlPlaneApiVersionSchema,
  service: z.object({ name: z.literal(CONTROL_PLANE_SERVICE_NAME), version: ToolVersionSchema }).strict(),
  mcp: z.object({ endpoint: z.literal("/mcp"), protocolVersion: z.literal(MCP_PROTOCOL_VERSION), stateless: z.literal(true) }).strict(),
  limits: CapabilityLimitsSchema,
} as const

const StructuralCapabilitiesBaseSchema = z.object({
  ...CapabilityResponseShape,
  tools: CapabilityToolListSchema,
}).strict()
export const StructuralCapabilitiesSchema = withDeepFrozenOutput(StructuralCapabilitiesBaseSchema)

const StructuralToolsResponseBaseSchema = z.object({
  ...CapabilityResponseShape,
  tools: ToolSchemaDescriptorListSchema,
}).strict()
export const StructuralToolsResponseSchema = withDeepFrozenOutput(StructuralToolsResponseBaseSchema)

export function createFrozenCapabilitiesSchema(
  refinement: (value: z.output<typeof StructuralCapabilitiesBaseSchema>, context: z.RefinementCtx) => void,
) {
  return withDeepFrozenOutput(StructuralCapabilitiesBaseSchema.superRefine(refinement))
}

export function createFrozenToolsResponseSchema(
  refinement: (value: z.output<typeof StructuralToolsResponseBaseSchema>, context: z.RefinementCtx) => void,
) {
  return withDeepFrozenOutput(StructuralToolsResponseBaseSchema.superRefine(refinement))
}

export type CapabilityLimits = z.output<typeof CapabilityLimitsSchema>
export type ToolDescriptor = z.output<typeof ToolDescriptorSchema>
export type ToolSchemaDescriptor = z.output<typeof ToolSchemaDescriptorSchema>
export type StructuralCapabilities = z.output<typeof StructuralCapabilitiesSchema>
export type StructuralToolsResponse = z.output<typeof StructuralToolsResponseSchema>
