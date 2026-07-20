import { z } from "zod"

import {
  generateCorpusMetadata,
  verifyCorpusAtRepository,
} from "./upstream-corpus-files.js"
import { CorpusVerificationError } from "./upstream-corpus-verifier.js"

const COMMAND = {
  GENERATE: "generate",
  VERIFY: "verify",
} as const

const CommandSchema = z.enum([COMMAND.GENERATE, COMMAND.VERIFY])

function assertNever(command: never): never {
  throw new CorpusVerificationError(`unsupported corpus command: ${JSON.stringify(command)}`)
}

async function main(): Promise<void> {
  const command = CommandSchema.parse(process.argv[2])
  const repositoryRoot = process.cwd()
  switch (command) {
    case COMMAND.GENERATE:
      await generateCorpusMetadata(repositoryRoot)
      console.log("UPSTREAM_CORPUS_GENERATED")
      return
    case COMMAND.VERIFY: {
      const result = await verifyCorpusAtRepository(repositoryRoot)
      console.log(`UPSTREAM_CORPUS_VERIFIED ${JSON.stringify(result)}`)
      return
    }
    default:
      return assertNever(command)
  }
}

main().catch((error: unknown) => {
  // no-excuse-ok: catch -- CLI process boundary converts failures to a non-zero exit.
  if (error instanceof Error) {
    console.error(`${error.name}: ${error.message}`)
  } else {
    console.error("Unknown corpus verifier failure")
  }
  process.exitCode = 1
})
