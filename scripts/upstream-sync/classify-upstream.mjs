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

export const TRACE_STATUS = Object.freeze({
  FOUND: "FOUND",
  NOT_FOUND: "NOT_FOUND",
  UNAVAILABLE: "UNAVAILABLE",
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

const REVIEW_REQUIRED_CATEGORIES = Object.freeze([
  CHANGE_CATEGORY.API,
  CHANGE_CATEGORY.BROWSER,
  CHANGE_CATEGORY.DEPENDENCY,
  CHANGE_CATEGORY.LICENSE,
  CHANGE_CATEGORY.MIGRATION,
])

const REVIEW_REASON_BY_CATEGORY = Object.freeze({
  [CHANGE_CATEGORY.API]: "API_REVIEW_REQUIRED",
  [CHANGE_CATEGORY.BROWSER]: "BROWSER_REVIEW_REQUIRED",
  [CHANGE_CATEGORY.DEPENDENCY]: "DEPENDENCY_REVIEW_REQUIRED",
  [CHANGE_CATEGORY.LICENSE]: "LICENSE_REVIEW_REQUIRED",
  [CHANGE_CATEGORY.MIGRATION]: "MIGRATION_REVIEW_REQUIRED",
})

function assertSha(value, name) {
  if (!SHA_PATTERN.test(value)) throw new Error(`${name} must be a 40-character lowercase commit SHA`)
}

function assertSafeEvidencePath(value) {
  if (typeof value !== "string" || value.trim() === "" || path.posix.isAbsolute(value) || value.includes("\\") || value.split("/").includes("..")) {
    throw new Error("review acknowledgement evidence path is unsafe")
  }
}

export function reviewSubjectSha256({ sourceSha, diffSha256, evidencePath, evidenceSha256, categories, reviewedReasons }) {
  const subject = {
    sourceSha,
    diffSha256,
    evidencePath,
    evidenceSha256,
    categories: [...categories].sort(),
    reviewedReasons: [...reviewedReasons].sort(),
  }
  return createHash("sha256").update(JSON.stringify(subject)).digest("hex")
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

export function validateReviewAcknowledgement(value, { sourceSha, diffSha256, categories, evidenceBytes }) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("review acknowledgement must be an object")
  const expectedKeys = ["schemaVersion", "sourceSha", "reviewSubjectSha256", "diffSha256", "evidencePath", "evidenceSha256", "categories", "reviewedReasons", "reviewer", "reviewedAt", "decision"]
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expectedKeys].sort())) throw new Error("review acknowledgement schema keys are not exact")
  assertSha(value.sourceSha, "review acknowledgement source SHA")
  assertSafeEvidencePath(value.evidencePath)
  if (value.schemaVersion !== 1 || value.sourceSha !== sourceSha || value.diffSha256 !== diffSha256 || !/^[0-9a-f]{64}$/u.test(value.evidenceSha256) || value.decision !== "ACKNOWLEDGED") throw new Error("review acknowledgement topology binding is invalid")
  if (!Array.isArray(value.categories) || JSON.stringify([...value.categories].sort()) !== JSON.stringify([...categories].sort())) throw new Error("review acknowledgement categories drift")
  const expectedReasons = categories.filter((category) => REVIEW_REQUIRED_CATEGORIES.includes(category)).map((category) => REVIEW_REASON_BY_CATEGORY[category]).sort()
  if (!Array.isArray(value.reviewedReasons) || JSON.stringify([...value.reviewedReasons].sort()) !== JSON.stringify(expectedReasons)) throw new Error("review acknowledgement reasons drift")
  if (typeof value.reviewer !== "string" || value.reviewer.trim() === "" || typeof value.reviewedAt !== "string" || Number.isNaN(Date.parse(value.reviewedAt))) throw new Error("review acknowledgement reviewer or timestamp is invalid")
  if (evidenceBytes === undefined) throw new Error("review acknowledgement evidence bytes are required")
  const actualEvidenceSha256 = createHash("sha256").update(evidenceBytes).digest("hex")
  if (actualEvidenceSha256 !== value.evidenceSha256) throw new Error("review acknowledgement evidence hash drift")
  if (reviewSubjectSha256(value) !== value.reviewSubjectSha256) throw new Error("review acknowledgement subject hash drift")
  return value
}

async function gitOutput(repositoryRoot, args, encoding = "utf8") {
  return (await execFileAsync("git", args, { cwd: repositoryRoot, encoding })).stdout
}

export async function collectUpstreamTraceability(repositoryRoot, lockSha, sourceSha) {
  try {
    await execFileAsync("git", ["merge-base", "--is-ancestor", lockSha, sourceSha], { cwd: repositoryRoot })
  } catch {
    return { status: TRACE_STATUS.UNAVAILABLE, baseSha: lockSha, headSha: sourceSha, commits: [], releaseNotes: { status: TRACE_STATUS.UNAVAILABLE, paths: [] }, migrationNotes: { status: TRACE_STATUS.UNAVAILABLE, paths: [] } }
  }
  const [logOutput, pathOutput] = await Promise.all([
    gitOutput(repositoryRoot, ["log", "--format=%H%x09%s", `${lockSha}..${sourceSha}`]),
    gitOutput(repositoryRoot, ["diff", "--name-only", "--find-renames", `${lockSha}..${sourceSha}`]),
  ])
  const commits = logOutput.split("\n").filter(Boolean).map((line) => {
    const separator = line.indexOf("\t")
    if (separator !== 40) throw new Error("upstream source range commit record is invalid")
    return { sha: line.slice(0, separator), subject: line.slice(separator + 1) }
  })
  const paths = pathOutput.split("\n").map((entry) => entry.trim()).filter(Boolean).sort()
  const releaseNotePaths = paths.filter((entry) => /(?:^|\/)(?:CHANGELOG|RELEASE(?:S|[-_.]NOTES?)?|UPGRAD(?:E|ING))(?:[-_.].*)?$/iu.test(entry) || /(?:^|\/)docs?\/(?:release|upgrade|migration)[^/]*\.(?:md|mdx|txt)$/iu.test(entry))
  const migrationNotePaths = paths.filter((entry) => /(?:^|\/)(?:migrations?|upgrade|upgrading)(?:\/|[-_.])/iu.test(entry))
  const note = (matched) => ({ status: matched.length > 0 ? TRACE_STATUS.FOUND : TRACE_STATUS.NOT_FOUND, paths: matched })
  return { status: TRACE_STATUS.FOUND, baseSha: lockSha, headSha: sourceSha, commits, releaseNotes: note(releaseNotePaths), migrationNotes: note(migrationNotePaths) }
}

export async function classifyUpstream({ repositoryRoot, managedSha, sourceSha, lockSha, mergeSha, observationAvailable = false, reviewAcknowledgementPath, evidenceRoot }) {
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
  const upstreamTraceability = await collectUpstreamTraceability(repositoryRoot, lockSha, sourceSha)
  if (upstreamTraceability.status === TRACE_STATUS.UNAVAILABLE) blockedReasons.push("UPSTREAM_RANGE_UNAVAILABLE")
  const requiresObservation = sourceSha !== lockSha
  if (requiresObservation && !observationAvailable) blockedReasons.push("OBSERVED_CORPUS_REQUIRED")
  if (categories.includes(CHANGE_CATEGORY.API)) blockedReasons.push("API_REVIEW_REQUIRED")
  if (categories.includes(CHANGE_CATEGORY.DEPENDENCY)) blockedReasons.push("DEPENDENCY_REVIEW_REQUIRED")
  if (categories.includes(CHANGE_CATEGORY.LICENSE)) blockedReasons.push("LICENSE_REVIEW_REQUIRED")
  if (categories.includes(CHANGE_CATEGORY.BROWSER)) blockedReasons.push("BROWSER_REVIEW_REQUIRED")
  if (categories.includes(CHANGE_CATEGORY.MIGRATION)) blockedReasons.push("MIGRATION_REVIEW_REQUIRED")
  let reviewAcknowledgement = null
  if (reviewAcknowledgementPath !== undefined) {
    try {
      const candidate = JSON.parse(await readFile(reviewAcknowledgementPath, "utf8"))
      assertSafeEvidencePath(candidate.evidencePath)
      const evidenceBytes = await readFile(path.resolve(evidenceRoot ?? repositoryRoot, candidate.evidencePath))
      reviewAcknowledgement = validateReviewAcknowledgement(candidate, { sourceSha, diffSha256: createHash("sha256").update(diffBytes).digest("hex"), categories, evidenceBytes })
      for (const reason of REVIEW_REQUIRED_CATEGORIES.map((category) => REVIEW_REASON_BY_CATEGORY[category])) {
        const index = blockedReasons.indexOf(reason)
        if (index !== -1) blockedReasons.splice(index, 1)
      }
    } catch (error) {
      blockedReasons.push("REVIEW_ACKNOWLEDGEMENT_INVALID")
    }
  }
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
    reviewAcknowledgement,
    upstreamTraceability,
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
  const reviewAcknowledgementPath = readArgument("--review-acknowledgement")
  const evidenceRoot = readArgument("--evidence-root")
  const outputPath = readArgument("--output")
  if (managedSha === undefined || sourceSha === undefined || lockSha === undefined || outputPath === undefined) {
    throw new Error("usage: classify-upstream.mjs --managed-sha <sha> --source-sha <sha> --lock-sha <sha> [--merge-sha <sha>] --output <path>")
  }
  const result = await classifyUpstream({ repositoryRoot, managedSha, sourceSha, lockSha, mergeSha, observationAvailable, reviewAcknowledgementPath, evidenceRoot })
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8")
  console.log(`UPSTREAM_CLASSIFICATION ${JSON.stringify(result)}`)
}

if (process.argv[1] !== undefined && path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "unknown upstream classification failure")
    process.exitCode = 1
  })
}
