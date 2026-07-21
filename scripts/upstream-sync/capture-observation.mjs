import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { access, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { runRepositoryObservation, RuntimeCaptureBlocked } from "./observation-runner.mjs"

const execFileAsync = promisify(execFile)
const SHA_PATTERN = /^[0-9a-f]{40}$/u
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u

export const OBSERVATION_ARTIFACTS = Object.freeze([
  "manifest.json",
  "observed-receipt.json",
  "rest.ndjson",
  "route-matrix.json",
  "session-id-verdict.json",
  "websocket.ndjson",
  "runtime-identity.json",
])

const OPTIONAL_ARTIFACTS = Object.freeze(["license-manifest.json", "scope-manifest.json"])
const PROVENANCE_FILE = "observation-provenance.json"

const sha256 = (value) => createHash("sha256").update(value).digest("hex")

async function assertCaptureScriptHash() {
  const expected = process.env.STEEL_CAPTURE_SCRIPT_SHA256
  const scriptPath = fileURLToPath(import.meta.url)
  if (typeof expected !== "string" || !DIGEST_PATTERN.test(expected) || sha256(await readFile(scriptPath)) !== expected) {
    throw new RuntimeCaptureBlocked("hash-bound repository capture script is unavailable")
  }
}

function assertSha(value, name) {
  if (!SHA_PATTERN.test(value)) throw new Error(`${name} must be a 40-character lowercase commit SHA`)
}

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch (error) {
    if (error?.code === "ENOENT") return false
    throw error
  }
}

async function listRegularFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.isSymbolicLink() || entry.isDirectory()) {
      throw new Error(`observation output must contain regular files only: ${entry.name}`)
    }
    if (!entry.isFile()) throw new Error(`observation output has unsupported entry: ${entry.name}`)
    files.push(entry.name)
  }
  return files.sort()
}

export function parseRuntimeIdentity(text, upstreamSha) {
  let identity
  try {
    identity = JSON.parse(text)
  } catch {
    throw new Error("runtime identity is not valid JSON")
  }
  if (identity === null || typeof identity !== "object" || Array.isArray(identity)) {
    throw new Error("runtime identity must be an object")
  }
  if (identity.schemaVersion !== 1 || identity.upstreamSha !== upstreamSha || identity.gitHead !== upstreamSha) {
    throw new Error("runtime identity is not pinned to the requested upstream SHA")
  }
  for (const field of ["runtimeVersion", "browserVersion"]) {
    if (typeof identity[field] !== "string" || identity[field].trim() === "") {
      throw new Error(`runtime identity is missing ${field}`)
    }
    if (/^(?:fixture|fake|unknown)(?:[-/]|$)/iu.test(identity[field].trim())) throw new Error(`runtime identity ${field} is fabricated`)
  }
  if (typeof identity.workerImageDigest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(identity.workerImageDigest)) {
    throw new Error("runtime identity workerImageDigest is not pinned")
  }
  if (/^sha256:(.)\1{63}$/u.test(identity.workerImageDigest)) throw new Error("runtime identity workerImageDigest is fabricated")
  return identity
}

async function assertCommit(repositoryRoot, upstreamSha) {
  await execFileAsync("git", ["-C", repositoryRoot, "cat-file", "-e", `${upstreamSha}^{commit}`])
  const { stdout } = await execFileAsync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"])
  const gitHead = stdout.trim()
  assertSha(gitHead, "checked-out git HEAD")
  return gitHead
}

/**
 * Execute the repository-owned observation runner and bind its output to the
 * requested git commit. Tests may inject an in-process runner dependency.
 */
export async function captureObservation({
  repositoryRoot,
  upstreamSha,
  outputDirectory,
  runner = runRepositoryObservation,
}) {
  assertSha(upstreamSha, "upstream SHA")
  if (typeof runner !== "function") throw new Error("observation runner dependency is invalid")
  const root = path.resolve(repositoryRoot)
  const destination = path.resolve(outputDirectory)
  const gitHead = await assertCommit(root, upstreamSha)
  if (gitHead !== upstreamSha) throw new Error("capture must run from the exact requested upstream SHA")
  await mkdir(path.dirname(destination), { recursive: true })
  if (await exists(destination)) {
    if ((await lstat(destination)).isSymbolicLink()) throw new Error("observation output directory may not be a symlink")
    const existing = await readdir(destination)
    if (existing.length > 0) throw new Error("observation output directory must be empty before capture")
    await rmdir(destination)
  }
  const stagingDirectory = await mkdtemp(path.join(path.dirname(destination), `.${path.basename(destination)}.capture-`))

  try {
    try {
      await runner({ repositoryRoot: root, upstreamSha, outputDirectory: stagingDirectory })
    } catch (error) {
      if (error?.code === "RUNTIME_CAPTURE_BLOCKED") throw error
      throw new RuntimeCaptureBlocked(`observation runner failed: ${error instanceof Error ? error.message : "unknown failure"}`)
    }

    const postCaptureGitHead = await assertCommit(root, upstreamSha)
    if (postCaptureGitHead !== upstreamSha) throw new Error("runtime capture changed the checked-out upstream SHA")

    const names = await listRegularFiles(stagingDirectory)
    const allowed = new Set([...OBSERVATION_ARTIFACTS, ...OPTIONAL_ARTIFACTS])
    for (const name of names) {
      if (!allowed.has(name)) throw new Error(`unknown observation artifact: ${name}`)
    }
    for (const name of OBSERVATION_ARTIFACTS) {
      if (!names.includes(name)) throw new Error(`observation artifact is missing: ${name}`)
    }
    const runtimeIdentityText = await readFile(path.join(stagingDirectory, "runtime-identity.json"), "utf8")
    parseRuntimeIdentity(runtimeIdentityText, upstreamSha)

    const artifacts = []
    for (const name of names) {
      const bytes = await readFile(path.join(stagingDirectory, name))
      artifacts.push({ path: name, sha256: sha256(bytes) })
    }
    const provenance = {
      schemaVersion: 1,
      upstreamSha,
      gitHead,
      captureToolVersion: "steel-managed-observation-v1",
      runtimeExecutable: "repository-owned-observation-runner-v1",
      runtimeArgs: [],
      capturePlanSha256: process.env.STEEL_RUNTIME_CAPTURE_PLAN_SHA256,
      capturedAt: new Date().toISOString(),
      runtimeIdentitySha256: sha256(Buffer.from(runtimeIdentityText, "utf8")),
      artifacts,
    }
    await writeFile(path.join(stagingDirectory, PROVENANCE_FILE), `${JSON.stringify(provenance, null, 2)}\n`, "utf8")
    await rename(stagingDirectory, destination)
    return { upstreamSha, outputDirectory: destination, provenance }
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true })
    throw error
  }
}

async function main() {
  const args = process.argv.slice(2)
  const readArgument = (name) => {
    const index = args.indexOf(name)
    return index === -1 ? undefined : args[index + 1]
  }
  const repositoryRoot = readArgument("--repository-root") ?? process.cwd()
  const upstreamSha = readArgument("--upstream-sha")
  const outputDirectory = readArgument("--output-directory")
  if (args.some((argument) => argument.startsWith("--runtime"))) {
    throw new Error("caller-selected runtime executables are forbidden")
  }
  if (upstreamSha === undefined || outputDirectory === undefined) {
    throw new Error("usage: capture-observation.mjs --upstream-sha <sha> --output-directory <path>")
  }
  await assertCaptureScriptHash()
  const result = await captureObservation({ repositoryRoot, upstreamSha, outputDirectory })
  console.log(`UPSTREAM_OBSERVATION_CAPTURED ${JSON.stringify(result.provenance)}`)
}

if (process.argv[1] !== undefined && path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "unknown observation capture failure"
    const prefix = error?.code === "RUNTIME_CAPTURE_BLOCKED" ? "RUNTIME_CAPTURE_BLOCKED: " : ""
    console.error(`${prefix}${message}`)
    process.exitCode = 1
  })
}
