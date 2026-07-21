import { fileURLToPath } from "node:url";
import { renderGeneratedManagedClient } from "./client-generation.js";
import { renderManagedOpenApi } from "./openapi-generation.js";

export type GeneratedArtifact = Readonly<{ path: string; content: string }>;

export function generatedManagedArtifacts(): readonly GeneratedArtifact[] {
  return [
    {
      path: fileURLToPath(
        new URL("../../../openapi/managed.json", import.meta.url),
      ),
      content: renderManagedOpenApi(),
    },
    {
      path: fileURLToPath(
        new URL("../../../../operations-client/src/index.ts", import.meta.url),
      ),
      content: renderGeneratedManagedClient(),
    },
  ];
}
