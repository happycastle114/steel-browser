import { readFile } from "node:fs/promises"
import path from "node:path"

import {
  OVERLAY_DESCRIPTOR_PATH,
  OVERLAY_ERROR_CODE,
  FIXTURE_EVALUATION_STATUS,
  VERIFICATION_STATUS,
  evaluateOverlayFixture,
  parseManagedOverlayDescriptor,
  parseOverlayFixture,
  verifyManagedOverlay,
} from "./managed-overlay.js"

const ARGUMENT = {
  PARENT: "--parent",
  OVERLAY: "--overlay",
  DESCRIPTOR: "--descriptor",
  FIXTURE: "--fixture",
  JSON: "--json",
} as const

type CliOptions = Readonly<{
  readonly parentPlanPath?: string | undefined
  readonly overlayPlanPath?: string | undefined
  readonly descriptorPath?: string | undefined
  readonly fixturePath?: string | undefined
  readonly json: boolean
}>

function usage(): never {
  throw new Error(
    `usage: npm run verify:managed-overlay -- ${ARGUMENT.PARENT} <parent-plan> ${ARGUMENT.OVERLAY} <overlay-plan> [${ARGUMENT.DESCRIPTOR} <path>] [${ARGUMENT.FIXTURE} <path>] [${ARGUMENT.JSON}]`,
  )
}

function parseArgs(argv: readonly string[]): CliOptions {
  let parentPlanPath: string | undefined
  let overlayPlanPath: string | undefined
  let descriptorPath: string | undefined
  let fixturePath: string | undefined
  let json = false

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    switch (argument) {
      case ARGUMENT.PARENT:
        parentPlanPath = argv[index + 1]
        index += 1
        break
      case ARGUMENT.OVERLAY:
        overlayPlanPath = argv[index + 1]
        index += 1
        break
      case ARGUMENT.DESCRIPTOR:
        descriptorPath = argv[index + 1]
        index += 1
        break
      case ARGUMENT.FIXTURE:
        fixturePath = argv[index + 1]
        index += 1
        break
      case ARGUMENT.JSON:
        json = true
        break
      default:
        return usage()
    }
  }

  if (fixturePath === undefined && (parentPlanPath === undefined || overlayPlanPath === undefined)) {
    return usage()
  }
  return { parentPlanPath, overlayPlanPath, descriptorPath, fixturePath, json }
}

async function verifyFixtureOnly(repositoryRoot: string, descriptorPath: string, fixturePath: string): Promise<void> {
  const descriptorText = await readFile(descriptorPath, "utf8")
  const descriptor = parseManagedOverlayDescriptor(JSON.parse(descriptorText))
  const fixture = parseOverlayFixture(JSON.parse(await readFile(fixturePath, "utf8")))
  const result = evaluateOverlayFixture(descriptor, fixture)
  if (result.status === FIXTURE_EVALUATION_STATUS.ACCEPTED) {
    throw new Error(`${OVERLAY_ERROR_CODE.FIXTURE_UNEXPECTED_ACCEPTANCE} ${path.relative(repositoryRoot, fixturePath)}`)
  }
  console.error(`EXPECTED_FIXTURE_REJECTION code=${result.code} detail=${result.detail}`)
  process.exitCode = 1
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const repositoryRoot = process.cwd()
  const descriptorPath = path.resolve(repositoryRoot, options.descriptorPath ?? OVERLAY_DESCRIPTOR_PATH)

  if (options.fixturePath !== undefined) {
    await verifyFixtureOnly(repositoryRoot, descriptorPath, path.resolve(options.fixturePath))
    return
  }

  if (options.parentPlanPath === undefined || options.overlayPlanPath === undefined) {
    return usage()
  }

  const result = await verifyManagedOverlay({
    repositoryRoot,
    parentPlanPath: options.parentPlanPath,
    overlayPlanPath: options.overlayPlanPath,
    descriptorPath: options.descriptorPath,
  })
  const output = {
    status: VERIFICATION_STATUS.VERIFIED,
    descriptorPath: result.descriptorPath,
    parentPlanSha256: result.parentPlanSha256,
    overlayPlanSha256: result.overlayPlanSha256,
    head: result.head,
    corpusCommit: result.corpusCommit,
    baseCommit: result.baseCommit,
    upstreamSha: result.corpus.upstreamSha,
    protocolCorpusSha256: result.corpus.protocolCorpusSha256,
    sessionIdVerdictSha256: result.corpus.sessionIdVerdictSha256,
    supersessionRows: result.supersessionRows,
    dependencyRows: result.dependencyRows,
    enumVocabularyCount: result.enumVocabularyCount,
  }
  if (options.json) {
    console.log(JSON.stringify(output, null, 2))
  } else {
    console.log(`MANAGED_OVERLAY_VERIFIED ${JSON.stringify(output)}`)
  }
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(`${error.name}: ${error.message}`)
  } else {
    console.error("Unknown managed overlay verifier failure")
  }
  process.exitCode = 1
})
