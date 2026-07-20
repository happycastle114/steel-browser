import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"

const LOCK_PATH = path.join("managed", "upstream.lock.json")
const CORPUS_ROOT = path.join("managed", "tests", "upstream")
const RECEIPT_SOURCE_PATH = path.join("managed", "shared", "src", "upstream-observed-receipt.ts")
const FINAL_LOCK_FIELDS_FILE = "final-lock-fields.json"
const CORPUS_FILES = [
  "manifest.json",
  "observed-receipt.json",
  "rest.ndjson",
  "route-matrix.json",
  "session-id-verdict.json",
  "websocket.ndjson",
]
const UPSTREAM_SHA_PATTERN = /^[0-9a-f]{40}$/u
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u

function assertUpstreamSha(value) {
  if (!UPSTREAM_SHA_PATTERN.test(value)) {
    throw new Error(`upstream SHA must be 40 lowercase hexadecimal characters: ${String(value)}`)
  }
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

function requireObservationSha(value, expectedSha, artifact) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.upstreamSha !== expectedSha) {
    throw new Error(`observed ${artifact} is not pinned to the requested upstream SHA`)
  }
}

async function validateObservedCorpus(directory, upstreamSha) {
  const texts = new Map()
  for (const fileName of CORPUS_FILES) {
    const filePath = path.join(directory, fileName)
    if (!(await pathExists(filePath))) throw new Error(`observed corpus artifact is missing: ${fileName}`)
    texts.set(fileName, await readFile(filePath, "utf8"))
  }

  requireObservationSha(JSON.parse(texts.get("manifest.json")), upstreamSha, "manifest")
  requireObservationSha(JSON.parse(texts.get("observed-receipt.json")), upstreamSha, "receipt")
  requireObservationSha(JSON.parse(texts.get("route-matrix.json")), upstreamSha, "route matrix")
  requireObservationSha(JSON.parse(texts.get("session-id-verdict.json")), upstreamSha, "session verdict")
  return texts
}

async function readFinalLockFields(directory) {
  const filePath = path.join(directory, FINAL_LOCK_FIELDS_FILE)
  if (!(await pathExists(filePath))) {
    throw new Error(`FINAL lock requires an observed ${FINAL_LOCK_FIELDS_FILE} artifact`)
  }
  const fields = JSON.parse(await readFile(filePath, "utf8"))
  for (const field of ["browserRuntimeContractSha256", "licenseManifestSha256", "scopeManifestSha256"]) {
    if (typeof fields[field] !== "string" || !DIGEST_PATTERN.test(fields[field])) {
      throw new Error(`FINAL lock field is missing or invalid: ${field}`)
    }
  }
  return {
    browserRuntimeContractSha256: fields.browserRuntimeContractSha256,
    licenseManifestSha256: fields.licenseManifestSha256,
    scopeManifestSha256: fields.scopeManifestSha256,
  }
}

async function copyObservedCorpus({ sourceDirectory, destinationDirectory, observedTexts }) {
  if (await pathExists(destinationDirectory)) {
    const existingTexts = await validateObservedCorpus(destinationDirectory, JSON.parse(observedTexts.get("manifest.json")).upstreamSha)
    for (const fileName of CORPUS_FILES) {
      if (existingTexts.get(fileName) !== observedTexts.get(fileName)) {
        throw new Error(`destination corpus already exists with different bytes: ${fileName}`)
      }
    }
    return false
  }
  await mkdir(path.dirname(destinationDirectory), { recursive: true })
  await cp(sourceDirectory, destinationDirectory, { recursive: true, errorOnExist: true })
  return true
}

async function updateReceiptSourceAnchor(repositoryRoot, upstreamSha, receiptText) {
  const sourcePath = path.join(repositoryRoot, RECEIPT_SOURCE_PATH)
  const source = await readFile(sourcePath, "utf8")
  const receiptDigest = sha256(receiptText)
  if (!DIGEST_PATTERN.test(receiptDigest)) throw new Error("observed receipt digest could not be computed")
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
 * Install a corpus captured against the exact requested upstream runtime.
 *
 * This function deliberately does not copy, rewrite, or re-anchor an older
 * observation. A caller must provide an independently captured directory whose
 * four JSON artifacts already carry the requested upstream SHA. FINAL locks
 * additionally require the captured browser/license/scope digest artifact.
 */
export async function prepareCorpus({ repositoryRoot, upstreamSha, observedCorpusDirectory }) {
  assertUpstreamSha(upstreamSha)
  if (observedCorpusDirectory === undefined) {
    throw new Error("legitimate observed corpus directory is required; refusing to carry forward an old receipt")
  }
  const root = path.resolve(repositoryRoot)
  const observedRoot = path.resolve(observedCorpusDirectory)
  const lockPath = path.join(root, LOCK_PATH)
  const lock = JSON.parse(await readFile(lockPath, "utf8"))
  const previousUpstreamSha = lock.upstreamSha
  assertUpstreamSha(previousUpstreamSha)
  const observedTexts = await validateObservedCorpus(observedRoot, upstreamSha)
  const finalLockFields = lock.lockStage === "FINAL" ? await readFinalLockFields(observedRoot) : {}
  const destinationDirectory = path.join(root, CORPUS_ROOT, upstreamSha)
  const changed = await copyObservedCorpus({
    sourceDirectory: observedRoot,
    destinationDirectory,
    observedTexts,
  })
  const receiptChanged = await updateReceiptSourceAnchor(root, upstreamSha, observedTexts.get("observed-receipt.json"))
  const manifestText = observedTexts.get("manifest.json")
  const sessionIdVerdictText = observedTexts.get("session-id-verdict.json")
  const nextLock = {
    ...lock,
    ...finalLockFields,
    upstreamSha,
    protocolCorpusSha256: sha256(manifestText),
    sessionIdVerdictSha256: sha256(sessionIdVerdictText),
  }
  await writeFile(lockPath, renderJson(nextLock), "utf8")
  return {
    changed: changed || receiptChanged || previousUpstreamSha !== upstreamSha,
    previousUpstreamSha,
    upstreamSha,
    receiptChanged,
  }
}

async function main() {
  const args = process.argv.slice(2)
  const repositoryRootIndex = args.indexOf("--repository-root")
  const upstreamShaIndex = args.indexOf("--upstream-sha")
  const observedDirectoryIndex = args.indexOf("--observed-corpus-directory")
  const repositoryRoot = repositoryRootIndex === -1 ? process.cwd() : args[repositoryRootIndex + 1]
  const upstreamSha = upstreamShaIndex === -1 ? undefined : args[upstreamShaIndex + 1]
  const observedCorpusDirectory = observedDirectoryIndex === -1 ? undefined : args[observedDirectoryIndex + 1]
  if (upstreamSha === undefined || observedCorpusDirectory === undefined) {
    throw new Error("usage: prepare-corpus.mjs [--repository-root <path>] --upstream-sha <sha> --observed-corpus-directory <path>")
  }
  const result = await prepareCorpus({ repositoryRoot, upstreamSha, observedCorpusDirectory })
  console.log(`UPSTREAM_CORPUS_PREPARED ${JSON.stringify(result)}`)
}

if (process.argv[1] !== undefined && path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "unknown corpus preparation failure")
    process.exitCode = 1
  })
}
