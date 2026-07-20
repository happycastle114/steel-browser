import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { createHash } from "node:crypto"
import { CORPUS_FILES, FINAL_ARTIFACT_FILES, LOCK_STAGE, sha256, validateEvidenceManifest, validateObservedCorpus } from "./prepare-corpus.mjs"
import { CHANGE_CATEGORY, classifyChangedPaths, validateReviewAcknowledgement } from "./classify-upstream.mjs"
import { assertScopeManifestCoversPaths } from "./corpus-evidence.mjs"

const execFileAsync = promisify(execFile)
const SHA_PATTERN = /^[0-9a-f]{40}$/u

function assertSha(value, name) {
  if (!SHA_PATTERN.test(value)) throw new Error(`${name} must be a 40-character lowercase SHA`)
}

function assertEvidencePath(value) {
  if (typeof value !== "string" || value.trim() === "" || path.posix.isAbsolute(value) || value.includes("\\") || value.split("/").includes("..")) {
    throw new Error("candidate review evidence path is unsafe")
  }
}

async function git(repositoryRoot, args, options = {}) {
  const result = await execFileAsync("git", args, { cwd: repositoryRoot, encoding: "utf8", ...options })
  return result.stdout
}

async function show(repositoryRoot, commitSha, filePath) {
  return git(repositoryRoot, ["show", `${commitSha}:${filePath}`])
}

async function verifyEvidenceBindings(repositoryRoot, commitSha, corpusRoot, manifestText, kind) {
  const manifest = validateEvidenceManifest(manifestText, corpusRoot.split("/").at(-1), kind)
  for (const artifact of manifest.artifacts) {
    let bytes
    try {
      bytes = Buffer.from(await show(repositoryRoot, commitSha, artifact.path), "utf8")
    } catch {
      throw new Error(`${kind} evidence artifact is not present in candidate commit: ${artifact.path}`)
    }
    if (bytes.byteLength !== artifact.bytes || sha256(bytes) !== artifact.sha256) {
      throw new Error(`${kind} evidence artifact hash drift: ${artifact.path}`)
    }
  }
  return manifest
}

async function verifyCommittedCorpus(repositoryRoot, commitSha, sourceSha, lockStage) {
  const corpusRoot = `managed/tests/upstream/${sourceSha}`
  const directory = await mkdtemp(path.join(os.tmpdir(), "steel-candidate-corpus-"))
  try {
    for (const fileName of [...CORPUS_FILES, ...(lockStage === LOCK_STAGE.FINAL ? FINAL_ARTIFACT_FILES : [])]) {
      await writeFile(path.join(directory, fileName), await show(repositoryRoot, commitSha, `${corpusRoot}/${fileName}`))
    }
    const texts = await validateObservedCorpus(directory, sourceSha, lockStage, { repositoryRoot, strict: true })
    return { corpusRoot, texts }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function parseStatuses(output) {
  const tokens = output.split("\0").filter(Boolean)
  const statuses = []
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++]
    if (!/^(?:A|M)$/u.test(status)) {
      throw new Error(`candidate commit contains unsupported change status: ${status}`)
    }
    const filePath = tokens[index++]
    if (filePath === undefined) throw new Error("candidate commit has a truncated name-status record")
    statuses.push({ status, path: filePath })
  }
  return statuses
}

async function assertRegularBlob(repositoryRoot, commitSha, filePath) {
  const output = await git(repositoryRoot, ["ls-tree", "-r", "--full-tree", commitSha, "--", filePath])
  const lines = output.trimEnd().split("\n").filter(Boolean)
  if (lines.length !== 1 || !/^100644 blob [0-9a-f]{40}\t/u.test(lines[0]) || !lines[0].endsWith(`\t${filePath}`)) {
    throw new Error(`candidate artifact is not a regular blob: ${filePath}`)
  }
}

function expectedGeneratedPaths(sourceSha, lockStage) {
  const corpusRoot = `managed/tests/upstream/${sourceSha}`
  const paths = [
    "managed/upstream.lock.json",
    "managed/shared/src/upstream-observed-receipt.ts",
    `${corpusRoot}/classification.json`,
    ...CORPUS_FILES.map((fileName) => `${corpusRoot}/${fileName}`),
  ]
  if (lockStage === LOCK_STAGE.FINAL) paths.push(...FINAL_ARTIFACT_FILES.map((fileName) => `${corpusRoot}/${fileName}`))
  return paths.sort()
}

/** Verify the exact candidate commit after all untrusted build/test gates. */
export async function verifyCandidateCommit({ repositoryRoot, commitSha, mergeCommitSha, managedSha, sourceSha, treeSha, allowedUntrackedPaths = [] }) {
  for (const [value, name] of [[commitSha, "candidate commit SHA"], [mergeCommitSha, "merge commit SHA"], [managedSha, "managed SHA"], [sourceSha, "source SHA"], [treeSha, "candidate tree SHA"]]) assertSha(value, name)
  const root = path.resolve(repositoryRoot)
  const parents = (await git(root, ["rev-list", "--parents", "-n", "1", commitSha])).trim().split(/\s+/u)
  if (parents.length !== 2 || parents[0] !== commitSha || parents[1] !== mergeCommitSha) {
    throw new Error("candidate commit must have exactly the generated commit and merge parent")
  }
  const mergeParents = (await git(root, ["rev-list", "--parents", "-n", "1", mergeCommitSha])).trim().split(/\s+/u)
  if (mergeParents.length !== 3 || mergeParents[0] !== mergeCommitSha || mergeParents[1] !== managedSha || mergeParents[2] !== sourceSha) {
    throw new Error("candidate merge parents are not the exact managed/source pair")
  }
  if ((await git(root, ["rev-parse", `${commitSha}^{tree}`])).trim() !== treeSha) throw new Error("candidate tree digest drift")
  const dirtyEntries = (await git(root, ["status", "--porcelain=v1", "--untracked-files=all"]))
    .split("\n")
    .filter(Boolean)
    .filter((entry) => !allowedUntrackedPaths.some((prefix) => entry.slice(3).startsWith(prefix)))
  if (dirtyEntries.length > 0) throw new Error(`candidate worktree must be clean: ${dirtyEntries.join(" | ")}`)

  const lockText = await show(root, commitSha, "managed/upstream.lock.json")
  const lock = JSON.parse(lockText)
  if (lock.schemaVersion !== 1 || lock.upstreamSha !== sourceSha) throw new Error("candidate lock is not pinned to source SHA")
  if (lock.lockStage !== LOCK_STAGE.FINAL && lock.lockStage !== LOCK_STAGE.CORPUS_LOCKED) throw new Error("candidate lock stage is invalid")
  const lockStage = lock.lockStage
  const expected = expectedGeneratedPaths(sourceSha, lockStage)
  const statuses = parseStatuses(await git(root, ["diff-tree", "--no-commit-id", "--name-status", "-z", "--find-renames", "-r", commitSha]))
  const actual = statuses.map((entry) => entry.path).sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const unexpected = actual.filter((entry) => !expected.includes(entry))
    const missing = expected.filter((entry) => !actual.includes(entry))
    throw new Error(`candidate generated path allowlist mismatch (unexpected=${unexpected.join(",")}; missing=${missing.join(",")})`)
  }
  for (const entry of statuses) {
    const expectedStatus = entry.path === "managed/upstream.lock.json" || entry.path === "managed/shared/src/upstream-observed-receipt.ts" ? "M" : "A"
    if (entry.status !== expectedStatus) throw new Error(`candidate generated path has wrong status: ${entry.status} ${entry.path}`)
  }
  for (const filePath of expected) await assertRegularBlob(root, commitSha, filePath)

  const { corpusRoot, texts } = await verifyCommittedCorpus(root, commitSha, sourceSha, lockStage)
  let scopeManifest = null
  if (lock.protocolCorpusSha256 !== sha256(Buffer.from(texts.get("manifest.json"), "utf8"))) throw new Error("candidate lock protocol corpus digest drift")
  if (lock.sessionIdVerdictSha256 !== sha256(Buffer.from(texts.get("session-id-verdict.json"), "utf8"))) throw new Error("candidate lock session verdict digest drift")
  if (lockStage === LOCK_STAGE.FINAL) {
    if (lock.browserRuntimeContractSha256 !== sha256(Buffer.from(texts.get("runtime-identity.json"), "utf8"))) throw new Error("candidate lock runtime contract digest drift")
    if (lock.licenseManifestSha256 !== sha256(Buffer.from(texts.get("license-manifest.json"), "utf8"))) throw new Error("candidate lock license manifest digest drift")
    if (lock.scopeManifestSha256 !== sha256(Buffer.from(texts.get("scope-manifest.json"), "utf8"))) throw new Error("candidate lock scope manifest digest drift")
    await verifyEvidenceBindings(root, commitSha, corpusRoot, texts.get("license-manifest.json"), "LICENSE")
    scopeManifest = await verifyEvidenceBindings(root, commitSha, corpusRoot, texts.get("scope-manifest.json"), "SCOPE")
  }
  const receiptDigest = sha256(Buffer.from(texts.get("observed-receipt.json"), "utf8"))
  const receiptSource = await show(root, commitSha, "managed/shared/src/upstream-observed-receipt.ts")
  const receiptMatch = receiptSource.match(new RegExp(`\\["${sourceSha}",\\s*"([0-9a-f]{64})"\\]`, "u"))
  if (receiptMatch?.[1] !== receiptDigest) throw new Error("candidate receipt source anchor does not bind observed receipt bytes")

  const classificationPath = `managed/tests/upstream/${sourceSha}/classification.json`
  const classification = JSON.parse(await show(root, commitSha, classificationPath))
  if (classification.schemaVersion !== 1 || classification.sourceSha !== sourceSha || classification.managedSha !== managedSha || classification.mergeSha !== mergeCommitSha || classification.blocked === true || classification.observationAvailable !== true || !Array.isArray(classification.changedPaths) || !Array.isArray(classification.blockedReasons) || typeof classification.blocked !== "boolean" || classification.blocked !== (classification.blockedReasons.length > 0)) {
    throw new Error("candidate classification is not bound to the exact candidate topology")
  }
  const sourceDiff = Buffer.from(await git(root, ["diff", "--binary", "--no-ext-diff", `${managedSha}...${sourceSha}`]), "utf8")
  const diffSha256 = createHash("sha256").update(sourceDiff).digest("hex")
  if (classification.diffSha256 !== diffSha256) throw new Error("candidate classification diff digest drift")
  const changedPaths = (await git(root, ["diff", "--name-only", "--find-renames", `${managedSha}...${sourceSha}`])).split("\n").map((entry) => entry.trim()).filter(Boolean).sort()
  if (JSON.stringify(classification.changedPaths) !== JSON.stringify(changedPaths)) throw new Error("candidate classification changed paths drift")
  if (scopeManifest !== null) assertScopeManifestCoversPaths(scopeManifest, changedPaths)
  const expectedCategories = classifyChangedPaths(changedPaths, sourceDiff.toString("utf8"))
  if (JSON.stringify(classification.categories) !== JSON.stringify(expectedCategories)) throw new Error("candidate classification categories drift")
  const reviewCategories = expectedCategories.filter((category) => [CHANGE_CATEGORY.BROWSER, CHANGE_CATEGORY.DEPENDENCY, CHANGE_CATEGORY.LICENSE, CHANGE_CATEGORY.MIGRATION].includes(category))
  const acknowledgementPath = `managed/tests/upstream-acknowledgements/${sourceSha}.json`
  const classificationAcknowledgement = classification.reviewAcknowledgement ?? null
  if (reviewCategories.length > 0) {
    let canonicalAcknowledgement
    try {
      canonicalAcknowledgement = JSON.parse(await show(root, commitSha, acknowledgementPath))
    } catch {
      throw new Error("candidate review acknowledgement is missing")
    }
    assertEvidencePath(canonicalAcknowledgement.evidencePath)
    if (classificationAcknowledgement === null) throw new Error("candidate classification acknowledgement is missing")
    assertEvidencePath(classificationAcknowledgement.evidencePath)
    const canonicalEvidence = await show(root, commitSha, canonicalAcknowledgement.evidencePath)
    const classificationEvidence = await show(root, commitSha, classificationAcknowledgement.evidencePath)
    validateReviewAcknowledgement(canonicalAcknowledgement, { sourceSha, diffSha256, categories: expectedCategories, evidenceBytes: Buffer.from(canonicalEvidence, "utf8") })
    validateReviewAcknowledgement(classificationAcknowledgement, { sourceSha, diffSha256, categories: expectedCategories, evidenceBytes: Buffer.from(classificationEvidence, "utf8") })
    if (JSON.stringify(canonicalAcknowledgement) !== JSON.stringify(classificationAcknowledgement)) throw new Error("candidate classification acknowledgement does not match canonical review evidence")
  } else if (classificationAcknowledgement !== null) {
    throw new Error("candidate classification contains an acknowledgement for an unreviewed change")
  }
  return { status: "VERIFIED", commitSha, mergeCommitSha, managedSha, sourceSha, treeSha, lockStage, paths: expected }
}

async function main() {
  const args = process.argv.slice(2)
  const readArgument = (name) => {
    const index = args.indexOf(name)
    return index === -1 ? undefined : args[index + 1]
  }
  const repositoryRoot = readArgument("--repository-root") ?? process.cwd()
  const values = {
    repositoryRoot,
    commitSha: readArgument("--commit-sha"),
    mergeCommitSha: readArgument("--merge-commit-sha"),
    managedSha: readArgument("--managed-sha"),
    sourceSha: readArgument("--source-sha"),
    treeSha: readArgument("--tree-sha"),
    allowedUntrackedPaths: args.flatMap((argument, index) => argument === "--allow-untracked-prefix" && args[index + 1] !== undefined ? [args[index + 1]] : []),
  }
  if (Object.values(values).some((value) => value === undefined)) throw new Error("usage: verify-candidate-commit.mjs --commit-sha <sha> --merge-commit-sha <sha> --managed-sha <sha> --source-sha <sha> --tree-sha <sha>")
  const result = await verifyCandidateCommit(values)
  console.log(`UPSTREAM_CANDIDATE_COMMIT_VERIFIED ${JSON.stringify(result)}`)
}

if (process.argv[1] !== undefined && path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "unknown candidate verification failure")
    process.exitCode = 1
  })
}
