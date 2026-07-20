import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

import { findRawStateComparisons, type RawStateComparisonViolation } from "./raw-state-comparison.js"

const CLI_ARGUMENT = { FIXTURE: "--fixture" } as const
const RAW_STATE_SCAN_CONFIG = {
  root: "managed",
  excludedFixtureRoot: "managed/tests/fixtures",
  excludedDirectoryNames: new Set(["build", "node_modules"]),
  extensions: [".ts", ".tsx", ".mts", ".cts"],
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

async function collectTypeScriptFiles(directory: string, repositoryRoot: string): Promise<readonly string[]> {
  const relativeDirectory = path.relative(repositoryRoot, directory)
  if (
    relativeDirectory === RAW_STATE_SCAN_CONFIG.excludedFixtureRoot ||
    relativeDirectory.startsWith(`${RAW_STATE_SCAN_CONFIG.excludedFixtureRoot}${path.sep}`)
  ) {
    return []
  }
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry): Promise<readonly string[]> => {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        return RAW_STATE_SCAN_CONFIG.excludedDirectoryNames.has(entry.name)
          ? []
          : collectTypeScriptFiles(entryPath, repositoryRoot)
      }
      return entry.isFile() && RAW_STATE_SCAN_CONFIG.extensions.some((extension) => entry.name.endsWith(extension))
        ? [entryPath]
        : []
    }),
  )
  return nested.flat().sort()
}

async function scanFiles(filePaths: readonly string[]): Promise<readonly RawStateComparisonViolation[]> {
  const violations = await Promise.all(
    filePaths.map(async (filePath) => findRawStateComparisons(await readFile(filePath, "utf8"), filePath)),
  )
  return violations.flat()
}

async function main(): Promise<void> {
  const repositoryRoot = process.cwd()
  const options = parseArguments(process.argv.slice(2))
  const filePaths =
    options.fixturePath === undefined
      ? await collectTypeScriptFiles(path.resolve(repositoryRoot, RAW_STATE_SCAN_CONFIG.root), repositoryRoot)
      : [path.resolve(repositoryRoot, options.fixturePath)]
  const violations = await scanFiles(filePaths)
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
