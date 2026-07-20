import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  DIGEST_PATTERN,
  assertRuntimeIdentity,
  assertStrictCoreArtifacts,
  assertUpstreamSha,
  parseObject,
  sha256,
} from "./corpus-schema.mjs"
import { assertProvenance, validateEvidenceManifest } from "./corpus-evidence.mjs"

export { sha256 } from "./corpus-schema.mjs"
export { validateEvidenceManifest } from "./corpus-evidence.mjs"

const LOCK_PATH = path.join("managed", "upstream.lock.json")
const CORPUS_ROOT = path.join("managed", "tests", "upstream")
const RECEIPT_SOURCE_PATH = path.join("managed", "shared", "src", "upstream-observed-receipt.ts")

export const LOCK_STAGE = Object.freeze({
  CORPUS_LOCKED: "CORPUS_LOCKED",
  FINAL: "FINAL",
})

export const CORPUS_FILES = Object.freeze([
  "manifest.json",
  "observed-receipt.json",
  "rest.ndjson",
  "route-matrix.json",
  "session-id-verdict.json",
  "websocket.ndjson",
  "runtime-identity.json",
  "observation-provenance.json",
])

export const FINAL_ARTIFACT_FILES = Object.freeze(["license-manifest.json", "scope-manifest.json"])

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

async function exactFileNames(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const names = []
  for (const entry of entries) {
    if (entry.isSymbolicLink() || entry.isDirectory() || !entry.isFile()) {
      throw new Error(`observed corpus contains a non-regular artifact: ${entry.name}`)
    }
    names.push(entry.name)
  }
  return names.sort()
}

function expectedFiles(lockStage) {
  if (lockStage === LOCK_STAGE.FINAL) return [...CORPUS_FILES, ...FINAL_ARTIFACT_FILES].sort()
  if (lockStage === LOCK_STAGE.CORPUS_LOCKED) return [...CORPUS_FILES].sort()
  throw new Error(`unsupported upstream lock stage: ${String(lockStage)}`)
}

export async function validateObservedCorpus(directory, upstreamSha, lockStage = LOCK_STAGE.CORPUS_LOCKED, options = {}) {
  const { repositoryRoot, strict = false } = options
  assertUpstreamSha(upstreamSha)
  const expected = expectedFiles(lockStage)
  const names = await exactFileNames(directory)
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    const missing = expected.filter((name) => !names.includes(name))
    const extra = names.filter((name) => !expected.includes(name))
    if (missing.length > 0) throw new Error(`observed corpus artifact is missing: ${missing.join(", ")}`)
    throw new Error(`observed corpus has unauthorized artifacts: ${extra.join(", ")}`)
  }

  const texts = new Map()
  for (const fileName of expected) texts.set(fileName, await readFile(path.join(directory, fileName), "utf8"))
  requireObservationSha(parseObject(texts.get("manifest.json"), "manifest"), upstreamSha, "manifest")
  requireObservationSha(parseObject(texts.get("observed-receipt.json"), "receipt"), upstreamSha, "receipt")
  requireObservationSha(parseObject(texts.get("route-matrix.json"), "route matrix"), upstreamSha, "route matrix")
  requireObservationSha(parseObject(texts.get("session-id-verdict.json"), "session verdict"), upstreamSha, "session verdict")
  assertRuntimeIdentity(parseObject(texts.get("runtime-identity.json"), "runtime identity"), upstreamSha)

  const observedArtifacts = new Map(expected.filter((name) => name !== "observation-provenance.json").map((name) => [name, texts.get(name)]))
  await assertProvenance(parseObject(texts.get("observation-provenance.json"), "observation provenance"), upstreamSha, observedArtifacts, { repositoryRoot, strict })
  if (strict) assertStrictCoreArtifacts(texts, upstreamSha)
  if (lockStage === LOCK_STAGE.FINAL) {
    validateEvidenceManifest(texts.get("license-manifest.json"), upstreamSha, "LICENSE")
    validateEvidenceManifest(texts.get("scope-manifest.json"), upstreamSha, "SCOPE")
  }
  return texts
}

async function copyObservedCorpus({ destinationDirectory, observedTexts, lockStage, repositoryRoot }) {
  const expected = expectedFiles(lockStage)
  if (await pathExists(destinationDirectory)) {
    for (const fileName of expected) {
      const existingPath = path.join(destinationDirectory, fileName)
      if (!(await pathExists(existingPath))) continue
      const existingBytes = await readFile(existingPath, "utf8")
      if (existingBytes !== observedTexts.get(fileName)) {
        throw new Error(`destination corpus already exists with different bytes: ${fileName}`)
      }
    }
    const existingTexts = await validateObservedCorpus(
      destinationDirectory,
      parseObject(observedTexts.get("manifest.json"), "manifest").upstreamSha,
      lockStage,
      { repositoryRoot },
    )
    for (const fileName of expected) {
      if (existingTexts.get(fileName) !== observedTexts.get(fileName)) {
        throw new Error(`destination corpus already exists with different bytes: ${fileName}`)
      }
    }
    return false
  }
  await mkdir(destinationDirectory, { recursive: true })
  for (const fileName of expected) await writeFile(path.join(destinationDirectory, fileName), observedTexts.get(fileName), "utf8")
  return true
}

async function updateReceiptSourceAnchor(repositoryRoot, upstreamSha, receiptText) {
  const sourcePath = path.join(repositoryRoot, RECEIPT_SOURCE_PATH)
  const source = await readFile(sourcePath, "utf8")
  const receiptDigest = sha256(Buffer.from(receiptText, "utf8"))
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

/** Install a corpus captured against the exact requested upstream runtime. */
export async function prepareCorpus({ repositoryRoot, upstreamSha, observedCorpusDirectory }) {
  assertUpstreamSha(upstreamSha)
  if (observedCorpusDirectory === undefined) {
    throw new Error("legitimate observed corpus directory is required; refusing to carry forward an old receipt")
  }
  const root = path.resolve(repositoryRoot)
  const observedRoot = path.resolve(observedCorpusDirectory)
  const lockPath = path.join(root, LOCK_PATH)
  const lock = parseObject(await readFile(lockPath, "utf8"), "upstream lock")
  const previousUpstreamSha = lock.upstreamSha
  assertUpstreamSha(previousUpstreamSha)
  if (lock.lockStage !== LOCK_STAGE.FINAL && lock.lockStage !== LOCK_STAGE.CORPUS_LOCKED) {
    throw new Error(`unsupported upstream lock stage: ${String(lock.lockStage)}`)
  }

  const lockStage = lock.lockStage
  const observedTexts = await validateObservedCorpus(observedRoot, upstreamSha, lockStage, { repositoryRoot: root, strict: false })
  const destinationDirectory = path.join(root, CORPUS_ROOT, upstreamSha)
  const changed = await copyObservedCorpus({ destinationDirectory, observedTexts, lockStage, repositoryRoot: root })
  const receiptChanged = await updateReceiptSourceAnchor(root, upstreamSha, observedTexts.get("observed-receipt.json"))
  const nextLock = {
    ...lock,
    upstreamSha,
    protocolCorpusSha256: sha256(Buffer.from(observedTexts.get("manifest.json"), "utf8")),
    sessionIdVerdictSha256: sha256(Buffer.from(observedTexts.get("session-id-verdict.json"), "utf8")),
  }
  if (lockStage === LOCK_STAGE.FINAL) {
    nextLock.browserRuntimeContractSha256 = sha256(Buffer.from(observedTexts.get("runtime-identity.json"), "utf8"))
    nextLock.licenseManifestSha256 = sha256(Buffer.from(observedTexts.get("license-manifest.json"), "utf8"))
    nextLock.scopeManifestSha256 = sha256(Buffer.from(observedTexts.get("scope-manifest.json"), "utf8"))
  }
  await writeFile(lockPath, renderJson(nextLock), "utf8")
  return { changed: changed || receiptChanged || previousUpstreamSha !== upstreamSha, previousUpstreamSha, upstreamSha, receiptChanged }
}

async function main() {
  const args = process.argv.slice(2)
  const readArgument = (name) => {
    const index = args.indexOf(name)
    return index === -1 ? undefined : args[index + 1]
  }
  const repositoryRoot = readArgument("--repository-root") ?? process.cwd()
  const upstreamSha = readArgument("--upstream-sha")
  const observedCorpusDirectory = readArgument("--observed-corpus-directory")
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
