import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { observeSteelRuntime } from "./steel-runtime-observer.mjs"

const execFileAsync = promisify(execFile)
const CORE_ARTIFACTS = Object.freeze(["manifest.json", "observed-receipt.json", "rest.ndjson", "route-matrix.json", "session-id-verdict.json", "websocket.ndjson"])
const SHA_PATTERN = /^[0-9a-f]{40}$/u
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u

export class RuntimeCaptureBlocked extends Error {
  constructor(message) {
    super(message)
    this.name = "RuntimeCaptureBlocked"
    this.code = "RUNTIME_CAPTURE_BLOCKED"
  }
}

const sha256File = async (filePath) => createHash("sha256").update(await readFile(filePath)).digest("hex")

async function checkedOutHead(repositoryRoot) {
  const { stdout } = await execFileAsync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"])
  const head = stdout.trim()
  if (!SHA_PATTERN.test(head)) throw new RuntimeCaptureBlocked("observation checkout HEAD is not a commit SHA")
  return head
}

export async function runRepositoryObservation({ repositoryRoot, upstreamSha, outputDirectory, observer = observeSteelRuntime }) {
  const runnerPath = fileURLToPath(import.meta.url)
  const expectedRunnerSha = process.env.STEEL_OBSERVATION_RUNNER_SHA256
  if (typeof expectedRunnerSha !== "string" || !/^[0-9a-f]{64}$/u.test(expectedRunnerSha) || await sha256File(runnerPath) !== expectedRunnerSha) {
    throw new RuntimeCaptureBlocked("hash-bound repository observation runner is unavailable")
  }
  const head = await checkedOutHead(repositoryRoot)
  if (head !== upstreamSha) throw new RuntimeCaptureBlocked("observation runner checkout does not match requested upstream SHA")
  const observation = await observer({ repositoryRoot, upstreamSha, outputDirectory })
  if (observation === null || typeof observation !== "object" || !Array.isArray(observation.artifacts)) throw new RuntimeCaptureBlocked("fixed observer returned no protocol corpus")
  if (typeof observation.browserVersion !== "string" || !DIGEST_PATTERN.test(observation.workerImageDigest)) throw new RuntimeCaptureBlocked("fixed observer returned no authoritative runtime identity")
  const artifacts = new Map(observation.artifacts.map((artifact) => [artifact.path, artifact.text]))
  if (CORE_ARTIFACTS.some((name) => typeof artifacts.get(name) !== "string")) throw new RuntimeCaptureBlocked("fixed observer returned an incomplete protocol corpus")
  await mkdir(outputDirectory, { recursive: true })
  for (const name of CORE_ARTIFACTS) await writeFile(`${outputDirectory}/${name}`, artifacts.get(name), "utf8")
  await writeFile(`${outputDirectory}/runtime-identity.json`, `${JSON.stringify({ schemaVersion: 1, upstreamSha, gitHead: head, runtimeVersion: process.version, browserVersion: observation.browserVersion, workerImageDigest: observation.workerImageDigest })}\n`, "utf8")
}

