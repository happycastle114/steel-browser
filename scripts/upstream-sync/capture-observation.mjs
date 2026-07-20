import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { access, lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

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

function parseRuntimeIdentity(text, upstreamSha) {
  let identity
  try {
    identity = JSON.parse(text)
  } catch {
    throw new Error("runtime identity is not valid JSON")
  }
  if (identity === null || typeof identity !== "object" || Array.isArray(identity)) {
    throw new Error("runtime identity must be an object")
  }
  if (identity.schemaVersion !== 1 || identity.upstreamSha !== upstreamSha) {
    throw new Error("runtime identity is not pinned to the requested upstream SHA")
  }
  for (const field of ["runtimeVersion", "browserVersion"]) {
    if (typeof identity[field] !== "string" || identity[field].trim() === "") {
      throw new Error(`runtime identity is missing ${field}`)
    }
  }
  if (typeof identity.workerImageDigest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(identity.workerImageDigest)) {
    throw new Error("runtime identity workerImageDigest is not pinned")
  }
  return identity
}

async function assertCommit(repositoryRoot, upstreamSha) {
  const { stdout } = await execFileAsync("git", ["-C", repositoryRoot, "cat-file", "-e", `${upstreamSha}^{commit}`])
  void stdout
}

/**
 * Execute the explicitly supplied runtime capture command and bind its output
 * to the requested git commit. The runtime receives only environment values;
 * no shell interpolation or caller-provided command string is used.
 */
export async function captureObservation({
  repositoryRoot,
  upstreamSha,
  outputDirectory,
  runtimeExecutable,
  runtimeArgs = [],
}) {
  assertSha(upstreamSha, "upstream SHA")
  if (typeof runtimeExecutable !== "string" || runtimeExecutable.trim() === "") {
    throw new Error("runtime executable is required")
  }
  if (!Array.isArray(runtimeArgs) || runtimeArgs.some((argument) => typeof argument !== "string")) {
    throw new Error("runtime arguments must be an array of strings")
  }
  const root = path.resolve(repositoryRoot)
  const destination = path.resolve(outputDirectory)
  await assertCommit(root, upstreamSha)
  if (await exists(destination)) {
    if ((await lstat(destination)).isSymbolicLink()) throw new Error("observation output directory may not be a symlink")
    const existing = await readdir(destination)
    if (existing.length > 0) throw new Error("observation output directory must be empty before capture")
  } else {
    await mkdir(destination, { recursive: true })
  }

  await execFileAsync(runtimeExecutable, runtimeArgs, {
    cwd: root,
    env: {
      ...process.env,
      STEEL_OBSERVATION_OUTPUT_DIR: destination,
      STEEL_OBSERVATION_UPSTREAM_SHA: upstreamSha,
    },
    maxBuffer: 16 * 1024 * 1024,
  })

  const names = await listRegularFiles(destination)
  const allowed = new Set([...OBSERVATION_ARTIFACTS, ...OPTIONAL_ARTIFACTS])
  for (const name of names) {
    if (!allowed.has(name)) throw new Error(`unknown observation artifact: ${name}`)
  }
  for (const name of OBSERVATION_ARTIFACTS) {
    if (!names.includes(name)) throw new Error(`observation artifact is missing: ${name}`)
  }
  const runtimeIdentityText = await readFile(path.join(destination, "runtime-identity.json"), "utf8")
  parseRuntimeIdentity(runtimeIdentityText, upstreamSha)

  const artifacts = []
  for (const name of names) {
    const bytes = await readFile(path.join(destination, name))
    artifacts.push({ path: name, sha256: sha256(bytes) })
  }
  const provenance = {
    schemaVersion: 1,
    upstreamSha,
    gitHead: upstreamSha,
    captureToolVersion: "steel-managed-observation-v1",
    runtimeExecutable,
    runtimeArgs,
    capturedAt: new Date().toISOString(),
    runtimeIdentitySha256: sha256(Buffer.from(runtimeIdentityText, "utf8")),
    artifacts,
  }
  await writeFile(path.join(destination, PROVENANCE_FILE), `${JSON.stringify(provenance, null, 2)}\n`, "utf8")
  return { upstreamSha, outputDirectory: destination, provenance }
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
  const runtimeExecutable = readArgument("--runtime-executable")
  const runtimeArgs = args.slice(args.indexOf("--runtime-arg") === -1 ? args.length : args.indexOf("--runtime-arg") + 1)
  if (upstreamSha === undefined || outputDirectory === undefined || runtimeExecutable === undefined) {
    throw new Error("usage: capture-observation.mjs --upstream-sha <sha> --output-directory <path> --runtime-executable <path> [--runtime-arg <arg> ...]")
  }
  const result = await captureObservation({ repositoryRoot, upstreamSha, outputDirectory, runtimeExecutable, runtimeArgs })
  console.log(`UPSTREAM_OBSERVATION_CAPTURED ${JSON.stringify(result.provenance)}`)
}

if (process.argv[1] !== undefined && path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "unknown observation capture failure")
    process.exitCode = 1
  })
}
