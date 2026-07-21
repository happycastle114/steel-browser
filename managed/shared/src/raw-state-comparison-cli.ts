import path from "node:path"

import { findRawStateComparisonsInSource, type RawStateComparisonViolation } from "./raw-state-comparison.js"
import { createSemanticProgram, resolveRepositoryPath } from "./semantic-typescript-program.js"
import { collectTypeScriptFiles } from "./typescript-source-files.js"

const CLI_ARGUMENT = { FIXTURE: "--fixture" } as const
const RAW_STATE_SCAN_CONFIG = {
  root: "managed",
  negativeFixture: path.normalize("managed/tests/fixtures/raw-state-comparison.ts"),
} as const
const RAW_STATE_SCAN_STATUS = {
  VERIFIED: "RAW_STATE_COMPARISONS_VERIFIED",
  REJECTED: "RAW_STATE_COMPARISON",
} as const

type CliOptions = Readonly<{ readonly fixturePath?: string | undefined }>

function parseArguments(argv: readonly string[]): CliOptions {
  switch (argv.length) {
    case 0:
      return {}
    case 2:
      if (argv[0] === CLI_ARGUMENT.FIXTURE && argv[1] !== undefined) return { fixturePath: argv[1] }
      throw new TypeError(`usage: check:raw-state-comparisons [${CLI_ARGUMENT.FIXTURE} <path>]`)
    default:
      throw new TypeError(`usage: check:raw-state-comparisons [${CLI_ARGUMENT.FIXTURE} <path>]`)
  }
}

function scanFiles(filePaths: readonly string[]): readonly RawStateComparisonViolation[] {
  const program = createSemanticProgram(filePaths)
  const checker = program.getTypeChecker()
  return filePaths.flatMap((filePath) => {
    const sourceFile = program.getSourceFile(path.resolve(filePath))
    if (sourceFile === undefined) throw new TypeError(`TypeScript source was not loaded: ${filePath}`)
    return findRawStateComparisonsInSource(sourceFile, checker)
  })
}

async function main(): Promise<void> {
  const repositoryRoot = resolveRepositoryPath(".")
  const options = parseArguments(process.argv.slice(2))
  const filePaths = options.fixturePath === undefined
    ? (await collectTypeScriptFiles(path.resolve(repositoryRoot, RAW_STATE_SCAN_CONFIG.root)))
      .filter((filePath) => path.relative(repositoryRoot, filePath) !== RAW_STATE_SCAN_CONFIG.negativeFixture)
    : [path.resolve(process.cwd(), options.fixturePath)]
  const violations = scanFiles(filePaths)
  for (const violation of violations) {
    console.error(
      `${RAW_STATE_SCAN_STATUS.REJECTED} ${path.relative(repositoryRoot, violation.filePath)}:${violation.line}:${violation.column} operator=${violation.operator} member=${violation.member}`,
    )
  }
  if (violations.length > 0) {
    process.exitCode = 1
    return
  }
  console.log(`${RAW_STATE_SCAN_STATUS.VERIFIED} files=${filePaths.length} members=all`)
}

main().catch((error: unknown) => {
  if (error instanceof Error) console.error(`${error.name}: ${error.message}`)
  else console.error("Unknown raw-state comparison guard failure")
  process.exitCode = 1
})
