import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import {
  generatedAiArtifacts,
  type GeneratedAiArtifact,
} from "./generated-artifacts.js"

const GENERATOR_COMMAND = { CHECK: "check", WRITE: "write" } as const
type GeneratorCommand = (typeof GENERATOR_COMMAND)[keyof typeof GENERATOR_COMMAND]

class AiArtifactDriftError extends Error {
  public override readonly name = "AiArtifactDriftError"
}

function parseCommand(value: string | undefined): GeneratorCommand {
  switch (value) {
    case GENERATOR_COMMAND.CHECK:
      return GENERATOR_COMMAND.CHECK
    case GENERATOR_COMMAND.WRITE:
      return GENERATOR_COMMAND.WRITE
    default:
      throw new TypeError("expected AI generator command: check or write")
  }
}

async function writeArtifacts(artifacts: readonly GeneratedAiArtifact[]): Promise<void> {
  for (const artifact of artifacts) {
    await mkdir(dirname(artifact.path), { recursive: true })
    await writeFile(artifact.path, artifact.content, "utf8")
  }
}

async function checkArtifacts(artifacts: readonly GeneratedAiArtifact[]): Promise<void> {
  const drifted: string[] = []
  for (const artifact of artifacts) {
    const current = await readFile(artifact.path, "utf8").catch(() => undefined)
    if (current !== artifact.content) drifted.push(artifact.path)
  }
  if (drifted.length > 0) throw new AiArtifactDriftError(`managed AI artifact drift: ${drifted.join(", ")}`)
}

const command = parseCommand(process.argv[2])
const artifacts = generatedAiArtifacts()
switch (command) {
  case GENERATOR_COMMAND.CHECK:
    await checkArtifacts(artifacts)
    break
  case GENERATOR_COMMAND.WRITE:
    await writeArtifacts(artifacts)
    break
}
