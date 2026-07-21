import { z } from "zod"

import { createAiToolPageSchemaForCatalog } from "./ai-tool-page-reader.js"
import { canonicalJson, type JsonValue } from "./canonical-json.js"
import { ManagedTransportConfigSchema } from "./managed-transport-config.js"
import type { SelectedPublicOrigin } from "./public-urls.js"
import {
  CapabilityLimitsSchema,
  ToolSchemaDescriptorSchema,
} from "./tool-capability-schemas.js"
import { TOOL_NAMES } from "./tool-registry.js"
import { createToolSchemaArtifacts } from "./tool-schema-artifacts.js"

function freezeRecursively(value: unknown): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return
  for (const nested of Object.values(value)) freezeRecursively(nested)
  Object.freeze(value)
}

function requireExactToolNames(
  tools: readonly Readonly<{ readonly name: (typeof TOOL_NAMES)[number] }>[],
  context: z.RefinementCtx,
): void {
  for (const [index, expectedName] of TOOL_NAMES.entries()) {
    if (tools[index]?.name !== expectedName) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "tool descriptors must match the canonical registry" })
      return
    }
  }
}

const CanonicalDescriptorListSchema = z.array(ToolSchemaDescriptorSchema)
  .length(TOOL_NAMES.length)
  .superRefine(requireExactToolNames)
  .transform((value) => {
    freezeRecursively(value)
    return value
  })

async function sha256(value: JsonValue): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value))
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export type AiToolPageConfig = Readonly<{
  readonly selectedOrigin: SelectedPublicOrigin
  readonly limits: z.input<typeof CapabilityLimitsSchema>
}>

export async function createAiToolPageContract(input: AiToolPageConfig) {
  const limits = CapabilityLimitsSchema.parse(input.limits)
  const transport = ManagedTransportConfigSchema.parse({
    httpBodyBytes: limits.httpBodyBytes,
    textBytes: limits.textBytes,
    binaryBytes: limits.binaryBytes,
    resultBytes: limits.resultBytes,
  })
  const { schemaArtifacts } = createToolSchemaArtifacts({ selectedOrigin: input.selectedOrigin, transport })
  const schemaDescriptors = Object.freeze(await Promise.all(schemaArtifacts.map(async (artifact) => Object.freeze({
    ...artifact,
    inputSchemaSha256: await sha256(artifact.inputSchema),
    outputSchemaSha256: await sha256(artifact.outputSchema),
  }))))
  const canonicalDescriptors = CanonicalDescriptorListSchema.parse(schemaDescriptors)
  return Object.freeze({
    schemaDescriptors: canonicalDescriptors,
    schema: createAiToolPageSchemaForCatalog(canonicalDescriptors),
  })
}

export async function createAiToolPageSchema(input: AiToolPageConfig) {
  return (await createAiToolPageContract(input)).schema
}

export type { AiToolPage } from "./ai-tool-page-reader.js"
