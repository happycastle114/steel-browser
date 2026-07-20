import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"

const LOCK_PATH = path.join("managed", "upstream.lock.json")
const CORPUS_ROOT = path.join("managed", "tests", "upstream")
const RECEIPT_SOURCE_PATH = path.join("managed", "shared", "src", "upstream-observed-receipt.ts")
const UPSTREAM_SHA_PATTERN = /^[0-9a-f]{40}$/u

function assertUpstreamSha(value) {
  if (!UPSTREAM_SHA_PATTERN.test(value)) {
    throw new Error(`upstream SHA must be 40 lowercase hexadecimal characters: ${String(value)}`)
  }
}

function rewriteUpstreamSha(value, upstreamSha) {
  if (Array.isArray(value)) return value.map((entry) => rewriteUpstreamSha(entry, upstreamSha))
  if (value === null || typeof value !== "object") return value

  const rewritten = {}
  for (const [key, entry] of Object.entries(value)) {
    rewritten[key] = key === "upstreamSha" ? upstreamSha : rewriteUpstreamSha(entry, upstreamSha)
  }
  return rewritten
}

export function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

function renderJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

async function pathExists(filePath) {
  try {
    await access(filePath)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
    throw error
  }
}

async function rewriteCorpusFiles(directory, upstreamSha) {
  const paths = {
    manifest: path.join(directory, "manifest.json"),
    observedReceipt: path.join(directory, "observed-receipt.json"),
    routeMatrix: path.join(directory, "route-matrix.json"),
    sessionIdVerdict: path.join(directory, "session-id-verdict.json"),
  }
  const manifest = rewriteUpstreamSha(JSON.parse(await readFile(paths.manifest, "utf8")), upstreamSha)
  const observedReceipt = rewriteUpstreamSha(JSON.parse(await readFile(paths.observedReceipt, "utf8")), upstreamSha)
  const routeMatrix = rewriteUpstreamSha(JSON.parse(await readFile(paths.routeMatrix, "utf8")), upstreamSha)
  const sessionIdVerdict = rewriteUpstreamSha(JSON.parse(await readFile(paths.sessionIdVerdict, "utf8")), upstreamSha)
  const routeMatrixText = renderJson(routeMatrix)
  const sessionIdVerdictText = renderJson(sessionIdVerdict)

  if (Array.isArray(manifest.artifacts)) {
    manifest.artifacts = manifest.artifacts.map((artifact) => {
      if (artifact.path === "route-matrix.json") return { ...artifact, sha256: sha256(routeMatrixText) }
      if (artifact.path === "session-id-verdict.json") return { ...artifact, sha256: sha256(sessionIdVerdictText) }
      return artifact
    })
  }
  if ("routeMatrixSha256" in observedReceipt) observedReceipt.routeMatrixSha256 = sha256(routeMatrixText)
  if ("sessionIdVerdictSha256" in observedReceipt) observedReceipt.sessionIdVerdictSha256 = sha256(sessionIdVerdictText)

  await Promise.all([
    writeFile(paths.routeMatrix, routeMatrixText, "utf8"),
    writeFile(paths.sessionIdVerdict, sessionIdVerdictText, "utf8"),
    writeFile(paths.observedReceipt, renderJson(observedReceipt), "utf8"),
  ])
  const manifestText = renderJson(manifest)
  await writeFile(paths.manifest, manifestText, "utf8")
  return {
    manifestText,
    observedReceiptText: await readFile(paths.observedReceipt, "utf8"),
    sessionIdVerdictText,
  }
}

async function updateReceiptSourceAnchor(repositoryRoot, upstreamSha, receiptText) {
  const sourcePath = path.join(repositoryRoot, RECEIPT_SOURCE_PATH)
  const source = await readFile(sourcePath, "utf8")
  const receiptDigest = sha256(receiptText)
  const existingEntry = source.match(new RegExp(`\\["${upstreamSha}",\\s*"([0-9a-f]{64})"\\]`, "u"))
  if (existingEntry !== null) {
    if (existingEntry[1] !== receiptDigest) throw new Error(`source-pinned receipt digest drift: ${upstreamSha}`)
    return false
  }

  const mapEnd = source.indexOf("\n])", source.indexOf("RECEIPT_SHA256_BY_UPSTREAM_SHA"))
  if (mapEnd === -1) throw new Error("source-pinned receipt map boundary is missing")
  const entry = `  ["${upstreamSha}", "${receiptDigest}"],`
  await writeFile(sourcePath, `${source.slice(0, mapEnd)}\n${entry}${source.slice(mapEnd)}`, "utf8")
  return true
}

/**
 * Copy the already observed corpus to a new immutable upstream-SHA directory.
 * The sync workflow calls this only after the old corpus verifies against the
 * merged source, proving that the pinned route sources remain byte-compatible.
 */
export async function prepareCorpus({ repositoryRoot, upstreamSha }) {
  assertUpstreamSha(upstreamSha)
  const root = path.resolve(repositoryRoot)
  const lockPath = path.join(root, LOCK_PATH)
  const lock = JSON.parse(await readFile(lockPath, "utf8"))
  const previousUpstreamSha = lock.upstreamSha
  assertUpstreamSha(previousUpstreamSha)

  if (previousUpstreamSha === upstreamSha) {
    return { changed: false, previousUpstreamSha, upstreamSha }
  }

  const sourceDirectory = path.join(root, CORPUS_ROOT, previousUpstreamSha)
  const destinationDirectory = path.join(root, CORPUS_ROOT, upstreamSha)
  if (!(await pathExists(sourceDirectory))) {
    throw new Error(`locked corpus directory is missing: ${path.relative(root, sourceDirectory)}`)
  }
  if (await pathExists(destinationDirectory)) {
    throw new Error(`destination corpus already exists: ${path.relative(root, destinationDirectory)}`)
  }

  await mkdir(path.dirname(destinationDirectory), { recursive: true })
  await cp(sourceDirectory, destinationDirectory, { recursive: true, errorOnExist: true })
  const { manifestText, observedReceiptText, sessionIdVerdictText } = await rewriteCorpusFiles(destinationDirectory, upstreamSha)
  await updateReceiptSourceAnchor(root, upstreamSha, observedReceiptText)
  await writeFile(
    lockPath,
    renderJson({
      ...lock,
      upstreamSha,
      protocolCorpusSha256: sha256(manifestText),
      sessionIdVerdictSha256: sha256(sessionIdVerdictText),
    }),
    "utf8",
  )
  return { changed: true, previousUpstreamSha, upstreamSha }
}

async function main() {
  const args = process.argv.slice(2)
  const repositoryRootIndex = args.indexOf("--repository-root")
  const upstreamShaIndex = args.indexOf("--upstream-sha")
  const repositoryRoot = repositoryRootIndex === -1 ? process.cwd() : args[repositoryRootIndex + 1]
  const upstreamSha = upstreamShaIndex === -1 ? undefined : args[upstreamShaIndex + 1]
  if (upstreamSha === undefined) throw new Error("usage: prepare-corpus.mjs [--repository-root <path>] --upstream-sha <sha>")
  const result = await prepareCorpus({ repositoryRoot, upstreamSha })
  console.log(`UPSTREAM_CORPUS_PREPARED ${JSON.stringify(result)}`)
}

if (process.argv[1] !== undefined && path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "unknown corpus preparation failure")
    process.exitCode = 1
  })
}
