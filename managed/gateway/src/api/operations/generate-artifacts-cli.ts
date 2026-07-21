import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  generatedManagedArtifacts,
  type GeneratedArtifact,
} from "./generated-artifacts.js";

const GENERATOR_COMMAND = { CHECK: "check", WRITE: "write" } as const;
type GeneratorCommand =
  (typeof GENERATOR_COMMAND)[keyof typeof GENERATOR_COMMAND];

class ManagedArtifactDriftError extends Error {
  public override readonly name = "ManagedArtifactDriftError";
}

class ManagedArtifactCommandError extends Error {
  public override readonly name = "ManagedArtifactCommandError";
}

function parseCommand(value: string | undefined): GeneratorCommand {
  switch (value) {
    case GENERATOR_COMMAND.CHECK:
      return GENERATOR_COMMAND.CHECK;
    case GENERATOR_COMMAND.WRITE:
      return GENERATOR_COMMAND.WRITE;
    default:
      throw new ManagedArtifactCommandError(
        "expected generator command: check or write",
      );
  }
}

async function writeArtifacts(
  artifacts: readonly GeneratedArtifact[],
): Promise<void> {
  for (const artifact of artifacts) {
    await mkdir(dirname(artifact.path), { recursive: true });
    await writeFile(artifact.path, artifact.content, "utf8");
  }
}

async function checkArtifacts(
  artifacts: readonly GeneratedArtifact[],
): Promise<void> {
  const drifted: string[] = [];
  for (const artifact of artifacts) {
    const current = await readFile(artifact.path, "utf8").catch(
      () => undefined,
    );
    if (current !== artifact.content) drifted.push(artifact.path);
  }
  if (drifted.length > 0) {
    throw new ManagedArtifactDriftError(
      `managed generated artifact drift: ${drifted.join(", ")}`,
    );
  }
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv[2]);
  const artifacts = generatedManagedArtifacts();
  switch (command) {
    case GENERATOR_COMMAND.CHECK:
      await checkArtifacts(artifacts);
      break;
    case GENERATOR_COMMAND.WRITE:
      await writeArtifacts(artifacts);
      break;
  }
}

await main();
