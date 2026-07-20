import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const execFileAsync = promisify(execFile)
const SHA_PATTERN = /^[0-9a-f]{40}$/u

export const CHANGE_CATEGORY = Object.freeze({
  API: "API",
  BROWSER: "BROWSER",
  LICENSE: "LICENSE",
  MIGRATION: "MIGRATION",
  SCOPE: "SCOPE",
})

const CATEGORY_PATTERNS = Object.freeze({
  [CHANGE_CATEGORY.API]: [/^api\//u, /(?:routes?|controllers?|schemas?|openapi|websocket)/iu],
  [CHANGE_CATEGORY.BROWSER]: [/(?:Dockerfile|browser|chrom(?:e|ium)|playwright|puppeteer)/iu],
  [CHANGE_CATEGORY.LICENSE]: [/(?:^|\/)(?:LICENSE|NOTICE)(?:\.|$)/iu],
  [CHANGE_CATEGORY.MIGRATION]: [/(?:migration|migrate|schema|prisma|drizzle)/iu],
  [CHANGE_CATEGORY.SCOPE]: [/(?:^|\/)(?:\.github|deploy|terraform|managed)(?:\/|$)/u],
})

function assertSha(value, name) {
  if (!SHA_PATTERN.test(value)) throw new Error(`${name} must be a 40-character lowercase commit SHA`)
}

export function classifyChangedPaths(paths) {
  const categories = new Set()
  for (const changedPath of paths) {
    for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
      if (patterns.some((pattern) => pattern.test(changedPath))) categories.add(category)
    }
  }
  return [...categories].sort()
}

export async function classifyUpstream({ repositoryRoot, managedSha, sourceSha, lockSha, observationAvailable = false }) {
  assertSha(managedSha, "managed SHA")
  assertSha(sourceSha, "source SHA")
  assertSha(lockSha, "lock SHA")
  const { stdout } = await execFileAsync("git", ["diff", "--name-only", "--find-renames", `${managedSha}...${sourceSha}`], { cwd: repositoryRoot })
  const changedPaths = stdout.split("\n").map((entry) => entry.trim()).filter(Boolean).sort()
  const categories = classifyChangedPaths(changedPaths)
  const blockedReasons = []
  const requiresObservation = sourceSha !== lockSha
  if (requiresObservation && !observationAvailable) blockedReasons.push("OBSERVED_CORPUS_REQUIRED")
  if (categories.includes(CHANGE_CATEGORY.LICENSE)) blockedReasons.push("LICENSE_REVIEW_REQUIRED")
  if (categories.includes(CHANGE_CATEGORY.BROWSER)) blockedReasons.push("BROWSER_REVIEW_REQUIRED")
  if (categories.includes(CHANGE_CATEGORY.MIGRATION)) blockedReasons.push("MIGRATION_REVIEW_REQUIRED")
  return {
    schemaVersion: 1,
    sourceSha,
    managedSha,
    lockSha,
    requiresObservation,
    changedPaths,
    categories,
    blocked: blockedReasons.length > 0,
    blockedReasons,
  }
}

async function main() {
  const args = process.argv.slice(2)
  const readArgument = (name) => {
    const index = args.indexOf(name)
    return index === -1 ? undefined : args[index + 1]
  }
  const repositoryRoot = readArgument("--repository-root") ?? process.cwd()
  const managedSha = readArgument("--managed-sha")
  const sourceSha = readArgument("--source-sha")
  const lockSha = readArgument("--lock-sha")
  const observationAvailable = args.includes("--observation-available")
  const outputPath = readArgument("--output")
  if (managedSha === undefined || sourceSha === undefined || lockSha === undefined || outputPath === undefined) {
    throw new Error("usage: classify-upstream.mjs --managed-sha <sha> --source-sha <sha> --lock-sha <sha> --output <path>")
  }
  const result = await classifyUpstream({ repositoryRoot, managedSha, sourceSha, lockSha, observationAvailable })
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8")
  console.log(`UPSTREAM_CLASSIFICATION ${JSON.stringify(result)}`)
}

if (process.argv[1] !== undefined && path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "unknown upstream classification failure")
    process.exitCode = 1
  })
}
