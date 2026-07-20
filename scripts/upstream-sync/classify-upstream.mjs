import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const SHA_PATTERN = /^[0-9a-f]{40}$/u

export const CHANGE_CATEGORY = Object.freeze({
  API: "API",
  BROWSER: "BROWSER",
  DEPENDENCY: "DEPENDENCY",
  LICENSE: "LICENSE",
  MIGRATION: "MIGRATION",
  SCOPE: "SCOPE",
})

const CATEGORY_PATTERNS = Object.freeze({
  [CHANGE_CATEGORY.API]: [/^api\//u, /(?:routes?|controllers?|schemas?|openapi|websocket)/iu],
  [CHANGE_CATEGORY.BROWSER]: [/(?:Dockerfile|browser|chrom(?:e|ium)|playwright|puppeteer|cdp)/iu],
  [CHANGE_CATEGORY.DEPENDENCY]: [/(?:^|\/)(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/iu],
  [CHANGE_CATEGORY.LICENSE]: [/(?:^|\/)(?:LICENSE|NOTICE|COPYING)(?:\.|$)/iu],
  [CHANGE_CATEGORY.MIGRATION]: [/(?:migration|migrate|schema|prisma|drizzle)/iu],
  [CHANGE_CATEGORY.SCOPE]: [/(?:^|\/)(?:\.github|deploy|terraform|managed)(?:\/|$)/u],
})

const CONTENT_PATTERNS = Object.freeze({
  [CHANGE_CATEGORY.API]: /(?:openapi|websocket|route|controller|endpoint|request|response)/iu,
  [CHANGE_CATEGORY.BROWSER]: /(?:playwright|puppeteer|chrom(?:e|ium)|browser|cdp|headless)/iu,
  [CHANGE_CATEGORY.DEPENDENCY]: /(?:"(?:dependencies|devDependencies|optionalDependencies|peerDependencies)"|npm (?:install|run|exec)|preinstall|postinstall)/iu,
  [CHANGE_CATEGORY.LICENSE]: /(?:SPDX-License-Identifier|Apache License|copyright|license|notice)/iu,
  [CHANGE_CATEGORY.MIGRATION]: /(?:migration|migrate|schema|prisma|drizzle)/iu,
  [CHANGE_CATEGORY.SCOPE]: /(?:\.github\/|deploy\/|terraform\/|managed\/)/iu,
})

function assertSha(value, name) {
  if (!SHA_PATTERN.test(value)) throw new Error(`${name} must be a 40-character lowercase commit SHA`)
}

export function classifyChangedPaths(paths, diffText = "") {
  const categories = new Set()
  for (const changedPath of paths) {
    for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
      if (patterns.some((pattern) => pattern.test(changedPath))) categories.add(category)
    }
  }
  for (const [category, pattern] of Object.entries(CONTENT_PATTERNS)) {
    if (pattern.test(diffText)) categories.add(category)
  }
  return [...categories].sort()
}

async function gitOutput(repositoryRoot, args, encoding = "utf8") {
  return (await execFileAsync("git", args, { cwd: repositoryRoot, encoding })).stdout
}

export async function classifyUpstream({ repositoryRoot, managedSha, sourceSha, lockSha, mergeSha, observationAvailable = false }) {
  assertSha(managedSha, "managed SHA")
  assertSha(sourceSha, "source SHA")
  assertSha(lockSha, "lock SHA")
  if (mergeSha !== undefined) assertSha(mergeSha, "merge SHA")
  const changedOutput = await gitOutput(repositoryRoot, ["diff", "--name-only", "--find-renames", `${managedSha}...${sourceSha}`])
  const changedPaths = changedOutput.split("\n").map((entry) => entry.trim()).filter(Boolean).sort()
  const diffBytes = Buffer.from(await gitOutput(repositoryRoot, ["diff", "--binary", "--no-ext-diff", `${managedSha}...${sourceSha}`]), "utf8")
  const diffText = diffBytes.toString("utf8")
  const categories = classifyChangedPaths(changedPaths, diffText)
  const blockedReasons = []
  const requiresObservation = sourceSha !== lockSha
  if (requiresObservation && !observationAvailable) blockedReasons.push("OBSERVED_CORPUS_REQUIRED")
  if (categories.includes(CHANGE_CATEGORY.DEPENDENCY)) blockedReasons.push("DEPENDENCY_REVIEW_REQUIRED")
  if (categories.includes(CHANGE_CATEGORY.LICENSE)) blockedReasons.push("LICENSE_REVIEW_REQUIRED")
  if (categories.includes(CHANGE_CATEGORY.BROWSER)) blockedReasons.push("BROWSER_REVIEW_REQUIRED")
  if (categories.includes(CHANGE_CATEGORY.MIGRATION)) blockedReasons.push("MIGRATION_REVIEW_REQUIRED")
  return {
    schemaVersion: 1,
    sourceSha,
    managedSha,
    lockSha,
    mergeSha: mergeSha ?? null,
    requiresObservation,
    observationAvailable,
    changedPaths,
    categories,
    diffSha256: createHash("sha256").update(diffBytes).digest("hex"),
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
  const mergeSha = readArgument("--merge-sha")
  const observationAvailable = args.includes("--observation-available")
  const outputPath = readArgument("--output")
  if (managedSha === undefined || sourceSha === undefined || lockSha === undefined || outputPath === undefined) {
    throw new Error("usage: classify-upstream.mjs --managed-sha <sha> --source-sha <sha> --lock-sha <sha> [--merge-sha <sha>] --output <path>")
  }
  const result = await classifyUpstream({ repositoryRoot, managedSha, sourceSha, lockSha, mergeSha, observationAvailable })
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8")
  console.log(`UPSTREAM_CLASSIFICATION ${JSON.stringify(result)}`)
}

if (process.argv[1] !== undefined && path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "unknown upstream classification failure")
    process.exitCode = 1
  })
}
