import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { observeSteelRuntime } from "./steel-runtime-observer.mjs"
import { assertStrictCoreArtifacts } from "./corpus-schema.mjs"

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

async function assertBoundScript(filePath, expected, detail) {
  if (typeof expected !== "string" || !/^[0-9a-f]{64}$/u.test(expected) || await sha256File(filePath) !== expected) {
    throw new RuntimeCaptureBlocked(detail)
  }
}

async function checkedOutHead(repositoryRoot) {
  const { stdout } = await execFileAsync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"])
  const head = stdout.trim()
  if (!SHA_PATTERN.test(head)) throw new RuntimeCaptureBlocked("observation checkout HEAD is not a commit SHA")
  return head
}

export async function runRepositoryObservation({ repositoryRoot, upstreamSha, outputDirectory, observer = observeSteelRuntime }) {
  const runnerPath = fileURLToPath(import.meta.url)
  const observerPath = fileURLToPath(new URL("./steel-runtime-observer.mjs", import.meta.url))
  const schemaPath = fileURLToPath(new URL("./corpus-schema.mjs", import.meta.url))
  const routeSourcePath = fileURLToPath(new URL("./runtime-route-source.mjs", import.meta.url))
  const probesPath = fileURLToPath(new URL("./runtime-probes.mjs", import.meta.url))
  const corpusPath = fileURLToPath(new URL("./runtime-corpus.mjs", import.meta.url))
  const planPath = process.env.STEEL_RUNTIME_CAPTURE_PLAN_FILE
  await assertBoundScript(runnerPath, process.env.STEEL_OBSERVATION_RUNNER_SHA256, "hash-bound repository observation runner is unavailable")
  await assertBoundScript(observerPath, process.env.STEEL_RUNTIME_OBSERVER_SHA256, "hash-bound Steel runtime observer is unavailable")
  await assertBoundScript(schemaPath, process.env.STEEL_CORPUS_SCHEMA_SHA256, "hash-bound corpus schema is unavailable")
  await assertBoundScript(routeSourcePath, process.env.STEEL_RUNTIME_ROUTE_SOURCE_SHA256, "hash-bound runtime route source is unavailable")
  await assertBoundScript(probesPath, process.env.STEEL_RUNTIME_PROBES_SHA256, "hash-bound runtime probes are unavailable")
  await assertBoundScript(corpusPath, process.env.STEEL_RUNTIME_CORPUS_SHA256, "hash-bound runtime corpus assembler is unavailable")
  if (typeof planPath !== "string") throw new RuntimeCaptureBlocked("hash-bound runtime capture plan is unavailable")
  await assertBoundScript(planPath, process.env.STEEL_RUNTIME_CAPTURE_PLAN_SHA256, "hash-bound runtime capture plan is unavailable")
  const head = await checkedOutHead(repositoryRoot)
  if (head !== upstreamSha) throw new RuntimeCaptureBlocked("observation runner checkout does not match requested upstream SHA")
  const observation = await observer({ repositoryRoot, upstreamSha, outputDirectory })
  if (observation === null || typeof observation !== "object" || !Array.isArray(observation.artifacts)) throw new RuntimeCaptureBlocked("fixed observer returned no protocol corpus")
  if (typeof observation.runtimeVersion !== "string" || !/^v\d+\.\d+\.\d+$/u.test(observation.runtimeVersion) || typeof observation.browserVersion !== "string" || !DIGEST_PATTERN.test(observation.workerImageDigest)) throw new RuntimeCaptureBlocked("fixed observer returned no authoritative runtime identity")
  const artifacts = new Map(observation.artifacts.map((artifact) => [artifact.path, artifact.text]))
  if (CORE_ARTIFACTS.some((name) => typeof artifacts.get(name) !== "string")) throw new RuntimeCaptureBlocked("fixed observer returned an incomplete protocol corpus")
  try {
    const verification = assertStrictCoreArtifacts(artifacts, upstreamSha)
    if (verification.manifest.restRouteCount !== 37 || verification.manifest.webSocketRouteCount !== 5 || verification.restRecords.length !== 37 || verification.webSocketRecords.length !== 5) {
      throw new Error("protocol corpus does not contain the complete 37 REST and 5 WebSocket observations")
    }
    const observedRouteIds = new Set([...verification.restRecords, ...verification.webSocketRecords].map((record) => record.routeId))
    if (observedRouteIds.size !== verification.matrix.routes.length || verification.matrix.routes.some((route) => !observedRouteIds.has(route.id))) {
      throw new Error("one or more runtime routes have no unique corpus observation")
    }
  } catch (error) {
    throw new RuntimeCaptureBlocked(`fixed observer returned an invalid protocol corpus: ${error instanceof Error ? error.message : "unknown validation failure"}`)
  }
  await mkdir(outputDirectory, { recursive: true })
  for (const name of CORE_ARTIFACTS) await writeFile(`${outputDirectory}/${name}`, artifacts.get(name), "utf8")
  await writeFile(`${outputDirectory}/runtime-identity.json`, `${JSON.stringify({ schemaVersion: 1, upstreamSha, gitHead: head, runtimeVersion: observation.runtimeVersion, browserVersion: observation.browserVersion, workerImageDigest: observation.workerImageDigest })}\n`, "utf8")
}
