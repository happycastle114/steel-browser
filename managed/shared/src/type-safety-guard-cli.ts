import path from "node:path"

import { createSemanticProgram, resolveRepositoryPath } from "./semantic-typescript-program.js"
import {
  createTypeSafetyContext,
  findTypeSafetyViolationsInSource,
  type TypeSafetyViolation,
} from "./type-safety-guard.js"
import { collectTypeScriptFiles } from "./typescript-source-files.js"

const SCAN_ROOT = "managed"

function scan(filePaths: readonly string[]): readonly TypeSafetyViolation[] {
  const program = createSemanticProgram(filePaths)
  const context = createTypeSafetyContext(program)
  return filePaths.flatMap((filePath) => {
    const sourceFile = program.getSourceFile(path.resolve(filePath))
    if (sourceFile === undefined) throw new TypeError(`TypeScript source was not loaded: ${filePath}`)
    return findTypeSafetyViolationsInSource(sourceFile, context)
  })
}

async function main(): Promise<void> {
  const repositoryRoot = resolveRepositoryPath(".")
  const files = await collectTypeScriptFiles(path.resolve(repositoryRoot, SCAN_ROOT))
  const violations = scan(files)
  for (const violation of violations) {
    console.error(`${violation.kind} ${path.relative(repositoryRoot, violation.filePath)}:${violation.line}:${violation.column}`)
  }
  if (violations.length > 0) {
    process.exitCode = 1
    return
  }
  console.log(`MANAGED_TYPE_SAFETY_VERIFIED files=${files.length}`)
}

main().catch((error: unknown) => {
  if (error instanceof Error) console.error(`${error.name}: ${error.message}`)
  else console.error("Unknown type-safety guard failure")
  process.exitCode = 1
})
