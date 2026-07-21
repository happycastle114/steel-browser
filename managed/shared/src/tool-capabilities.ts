import { createHash } from "node:crypto"

import { z } from "zod"

import { canonicalJson, type JsonValue } from "./canonical-json.js"
import type { ControlPlaneConfig } from "./control-plane-config.js"
import { deriveManagedServiceLimits } from "./managed-service-limits.js"
import { ManagedTransportConfigSchema } from "./managed-transport-config.js"
import type { SelectedPublicOrigin } from "./public-urls.js"
import {
  CapabilityLimitsSchema,
  createFrozenCapabilitiesSchema,
  createFrozenToolsResponseSchema,
} from "./tool-capability-schemas.js"
import { createToolSchemaArtifacts } from "./tool-schema-artifacts.js"

function sha256(value: JsonValue): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

function requireCanonicalTools(
  tools: readonly Readonly<Record<string, unknown>>[],
  expected: readonly Readonly<Record<string, unknown>>[],
  context: z.RefinementCtx,
): void {
  if (canonicalJson(tools) !== canonicalJson(expected)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "tools must match the generated canonical registry" })
  }
}

export type ToolContractConfig = Readonly<{
  readonly selectedOrigin: SelectedPublicOrigin
  readonly limits: z.input<typeof CapabilityLimitsSchema>
}>

export type ManagedToolContractConfig = Readonly<{
  readonly selectedOrigin: SelectedPublicOrigin
  readonly controlPlaneConfig: ControlPlaneConfig
}>

export function deriveCapabilityLimits(config: ControlPlaneConfig): z.output<typeof CapabilityLimitsSchema> {
  const service = deriveManagedServiceLimits(config)
  return CapabilityLimitsSchema.parse({
    ...service.transport,
    ...service.capability,
  })
}

export function createToolContractCatalog(input: ToolContractConfig) {
  const limits = Object.freeze(CapabilityLimitsSchema.parse(input.limits))
  const transport = ManagedTransportConfigSchema.parse({
    httpBodyBytes: limits.httpBodyBytes,
    textBytes: limits.textBytes,
    binaryBytes: limits.binaryBytes,
    resultBytes: limits.resultBytes,
  })
  const { definitionRegistry, schemaArtifacts } = createToolSchemaArtifacts({
    selectedOrigin: input.selectedOrigin,
    transport,
  })
  const schemaDescriptors = Object.freeze(schemaArtifacts.map((artifact) => {
    return Object.freeze({
      ...artifact,
      inputSchemaSha256: sha256(artifact.inputSchema),
      outputSchemaSha256: sha256(artifact.outputSchema),
    })
  }))
  const descriptors = Object.freeze(schemaDescriptors.map((tool) => Object.freeze({
    name: tool.name,
    version: tool.version,
    mutability: tool.mutability,
    sessionRequirement: tool.sessionRequirement,
    inputSchemaSha256: tool.inputSchemaSha256,
    outputSchemaSha256: tool.outputSchemaSha256,
  })))
  const requireConfiguredLimits = (
    value: Readonly<{ readonly limits: z.output<typeof CapabilityLimitsSchema> }>,
    context: z.RefinementCtx,
  ): void => {
    if (canonicalJson(value.limits) !== canonicalJson(limits)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "capability limits must match configured limits" })
    }
  }
  const capabilitiesSchema = createFrozenCapabilitiesSchema((value, context) => {
    requireCanonicalTools(value.tools, descriptors, context)
    requireConfiguredLimits(value, context)
  })
  const toolsResponseSchema = createFrozenToolsResponseSchema((value, context) => {
    requireCanonicalTools(value.tools, schemaDescriptors, context)
    requireConfiguredLimits(value, context)
  })
  return Object.freeze({
    definitionRegistry,
    schemaDescriptors,
    descriptors,
    capabilitiesSchema,
    toolsResponseSchema,
    limits,
  })
}

export function createManagedToolContracts(input: ManagedToolContractConfig) {
  return createToolContractCatalog({
    selectedOrigin: input.selectedOrigin,
    limits: deriveCapabilityLimits(input.controlPlaneConfig),
  })
}
