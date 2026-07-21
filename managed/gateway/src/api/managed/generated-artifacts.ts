import { fileURLToPath } from "node:url"

import { renderGeneratedAiClientContract } from "./client-generation.js"
import { renderAiOpenApi } from "./openapi-generation.js"

export type GeneratedAiArtifact = Readonly<{ readonly path: string; readonly content: string }>

export function generatedAiArtifacts(): readonly GeneratedAiArtifact[] {
  return Object.freeze([
    Object.freeze({
      path: fileURLToPath(new URL("../../../openapi/managed-ai.json", import.meta.url)),
      content: renderAiOpenApi(),
    }),
    Object.freeze({
      path: fileURLToPath(new URL("../../../../ai-client/src/generated-contract.ts", import.meta.url)),
      content: renderGeneratedAiClientContract(),
    }),
  ])
}
