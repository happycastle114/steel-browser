import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import test from "node:test"

import { captureObservation, parseRuntimeIdentity } from "./capture-observation.mjs"
import { runRepositoryObservation } from "./observation-runner.mjs"
import { prepareCorpus } from "./prepare-corpus.mjs"

const execFileAsync = promisify(execFile)
const runGit = async (root, ...args) => (await execFileAsync("git", ["-C", root, ...args])).stdout.trim()
const sha256File = async (filePath) => createHash("sha256").update(await readFile(filePath)).digest("hex")
const sha256Text = (text) => createHash("sha256").update(text).digest("hex")

function completeObserverOutput(upstreamSha) {
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`
  const restRoutes = Array.from({ length: 37 }, (_, index) => ({ protocol: "REST", id: `rest.fixture.${index}`, method: "GET", path: `/v1/fixture/${index}`, source: `api/src/fixture-${index}.ts`, runtimeCondition: "ALWAYS", affinity: "NONE", lifecycle: "READ", mutating: false, implicitHead: true, expected: { statuses: [200], contentTypes: ["application/json"], headers: ["content-type"], urlFields: [] } }))
  const webSocketRoutes = Array.from({ length: 5 }, (_, index) => ({ protocol: "WEBSOCKET", id: `ws.fixture.${index}`, path: `/ws/fixture/${index}`, source: `api/src/ws-fixture-${index}.ts`, runtimeCondition: "ALWAYS", affinity: "NONE", lifecycle: "WEBSOCKET", mutating: false, upgradeClass: "LOGS", expectedCloseCodes: [1000] }))
  const restRecords = restRoutes.map((route, index) => ({ schemaVersion: 1, id: `record.rest.fixture.${index}`, routeId: route.id, scenario: "complete observer fixture", request: { method: route.method, path: route.path, bodyKind: "EMPTY" }, response: { status: 200, contentType: "application/json", headers: { "content-type": "application/json" }, bodyKind: "JSON", bodySha256: sha256Text(`rest-${index}`), urlFields: {} } }))
  const webSocketRecords = webSocketRoutes.map((route, index) => ({ schemaVersion: 1, id: `record.ws.fixture.${index}`, routeId: route.id, scenario: "complete observer fixture", requestPath: route.path, opened: true, messageKind: "OPEN_NO_MESSAGE", closeCode: 1000 }))
  const restText = restRecords.map((record) => JSON.stringify(record)).join("\n") + "\n"
  const webSocketText = webSocketRecords.map((record) => JSON.stringify(record)).join("\n") + "\n"
  const routeMatrixText = json({ schemaVersion: 1, upstreamSha, runtimeProfile: { nodeEnv: "development", logStorageEnabled: true }, routes: [...restRoutes, ...webSocketRoutes] })
  const sessionIdVerdictText = json({ schemaVersion: 1, upstreamSha, mode: "CLIENT_SUPPLIED", callerSessionId: "11111111-2222-4333-8444-555555555555", createReturnedCallerId: true, freshConnectionListRecoveredActiveId: true, freshConnectionGetRecoveredActiveId: true, releaseReturnedActiveId: true, createJournalBinding: "CLIENT_ID_DIRECT" })
  const manifestText = json({ schemaVersion: 1, upstreamSha, sessionIdMode: "CLIENT_SUPPLIED", sourceInventorySha256: sha256Text("complete-source-inventory"), sources: [{ path: "api/src/fixture.ts", sha256: sha256Text("fixture source") }], artifacts: [
    { path: "rest.ndjson", sha256: sha256Text(restText), records: restRecords.length },
    { path: "websocket.ndjson", sha256: sha256Text(webSocketText), records: webSocketRecords.length },
    { path: "route-matrix.json", sha256: sha256Text(routeMatrixText), records: restRoutes.length + webSocketRoutes.length },
    { path: "session-id-verdict.json", sha256: sha256Text(sessionIdVerdictText), records: 1 },
  ], restRouteCount: restRoutes.length, webSocketRouteCount: webSocketRoutes.length })
  const observedReceiptText = json({ schemaVersion: 1, upstreamSha, routeMatrixSha256: sha256Text(routeMatrixText), sessionIdVerdictSha256: sha256Text(sessionIdVerdictText), rest: restRecords.map((record) => ({ id: record.id, routeId: record.routeId, request: { method: record.request.method, path: record.request.path }, response: { status: record.response.status, contentType: record.response.contentType, headers: record.response.headers, bodySha256: record.response.bodySha256, urlFields: record.response.urlFields } })), webSocket: webSocketRecords.map((record) => ({ id: record.id, routeId: record.routeId, requestPath: record.requestPath, opened: record.opened, messageKind: record.messageKind, closeCode: record.closeCode })) })
  const texts = new Map([["manifest.json", manifestText], ["observed-receipt.json", observedReceiptText], ["rest.ndjson", restText], ["route-matrix.json", routeMatrixText], ["session-id-verdict.json", sessionIdVerdictText], ["websocket.ndjson", webSocketText]])
  return { runtimeVersion: "v22.23.1", browserVersion: "chromium-test/140.0", workerImageDigest: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", artifacts: [...texts].map(([path, text]) => ({ path, text })) }
}

function duplicateCoverageOutput(upstreamSha) {
  const output = completeObserverOutput(upstreamSha)
  const texts = new Map(output.artifacts.map((artifact) => [artifact.path, artifact.text]))
  const restRecords = texts.get("rest.ndjson").trim().split("\n").map((line) => JSON.parse(line))
  restRecords[1].routeId = restRecords[0].routeId
  const restText = restRecords.map((record) => JSON.stringify(record)).join("\n") + "\n"
  const receipt = JSON.parse(texts.get("observed-receipt.json"))
  receipt.rest[1].routeId = receipt.rest[0].routeId
  const manifest = JSON.parse(texts.get("manifest.json"))
  manifest.artifacts.find((artifact) => artifact.path === "rest.ndjson").sha256 = sha256Text(restText)
  texts.set("rest.ndjson", restText)
  texts.set("observed-receipt.json", `${JSON.stringify(receipt, null, 2)}\n`)
  texts.set("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`)
  return { ...output, artifacts: [...texts].map(([path, text]) => ({ path, text })) }
}

test("runtime identity parser rejects static fabricated runtime fields", () => {
  const sha = "a".repeat(40)
  assert.throws(() => parseRuntimeIdentity(JSON.stringify({ schemaVersion: 1, upstreamSha: sha, gitHead: sha, runtimeVersion: "fixture", browserVersion: "chromium-test/140.0", workerImageDigest: `sha256:${"1".repeat(64)}` }), sha), /fabricated/)
})

test("production capture CLI rejects caller-selected executables and JSON input", async () => {
  await assert.rejects(execFileAsync(process.execPath, [path.resolve("scripts/upstream-sync/capture-observation.mjs"), "--upstream-sha", "a".repeat(40), "--output-directory", "/tmp/capture", "--runtime-executable", "/tmp/arbitrary"]), /caller-selected runtime executables are forbidden/)
})

test("production capture CLI rejects a tampered capture script binding", async (t) => {
  const root = await createGitRoot()
  const upstreamSha = await runGit(root, "rev-parse", "HEAD")
  t.after(() => rm(root, { recursive: true, force: true }))
  await assert.rejects(
    execFileAsync(process.execPath, [path.resolve("scripts/upstream-sync/capture-observation.mjs"), "--repository-root", root, "--upstream-sha", upstreamSha, "--output-directory", path.join(root, "blocked")], { env: { ...process.env, STEEL_CAPTURE_SCRIPT_SHA256: "0".repeat(64) } }),
    /RUNTIME_CAPTURE_BLOCKED: hash-bound repository capture script is unavailable/,
  )
})

test("default production runner blocks without real runtime prerequisites", async (t) => {
  const root = await createGitRoot()
  const upstreamSha = await runGit(root, "rev-parse", "HEAD")
  t.after(() => rm(root, { recursive: true, force: true }))
  await assert.rejects(captureObservation({ repositoryRoot: root, upstreamSha, outputDirectory: path.join(root, "blocked") }), (error) => error?.code === "RUNTIME_CAPTURE_BLOCKED")
})

test("captureObservation removes partial staged output after a typed runtime block", async (t) => {
  const root = await createGitRoot()
  const upstreamSha = await runGit(root, "rev-parse", "HEAD")
  const outputDirectory = path.join(root, "partial-blocked")
  t.after(() => rm(root, { recursive: true, force: true }))
  await assert.rejects(captureObservation({ repositoryRoot: root, upstreamSha, outputDirectory, runner: async ({ outputDirectory: stagingDirectory }) => {
    await writeFile(path.join(stagingDirectory, "manifest.json"), "partial\n")
    const error = new Error("runtime blocked after partial output")
    error.code = "RUNTIME_CAPTURE_BLOCKED"
    throw error
  } }), (error) => error?.code === "RUNTIME_CAPTURE_BLOCKED")
  await assert.rejects(readFile(path.join(outputDirectory, "manifest.json")), (error) => error?.code === "ENOENT")
})

async function createGitRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "steel-observation-capture-"))
  await runGit(root, "init", "-q")
  await runGit(root, "config", "user.name", "capture-fixture")
  await runGit(root, "config", "user.email", "capture@example.invalid")
  await writeFile(path.join(root, "README.md"), "capture fixture\n")
  await runGit(root, "add", "README.md")
  await runGit(root, "commit", "-qm", "capture fixture")
  return root
}

async function writeFixtureObservation(outputDirectory, upstreamSha) {
  await mkdir(outputDirectory, { recursive: true })
  const json = (name, value) => writeFile(path.join(outputDirectory, name), `${JSON.stringify(value)}\n`)
  await json("manifest.json", { schemaVersion: 1, upstreamSha, artifacts: [] })
  await json("observed-receipt.json", { schemaVersion: 1, upstreamSha, routeMatrixSha256: "0".repeat(64), sessionIdVerdictSha256: "0".repeat(64) })
  await json("route-matrix.json", { schemaVersion: 1, upstreamSha, routes: [] })
  await json("session-id-verdict.json", { schemaVersion: 1, upstreamSha, mode: "CLIENT_SUPPLIED" })
  await writeFile(path.join(outputDirectory, "rest.ndjson"), "rest\n")
  await writeFile(path.join(outputDirectory, "websocket.ndjson"), "ws\n")
  await json("runtime-identity.json", { schemaVersion: 1, upstreamSha, gitHead: upstreamSha, runtimeVersion: "steel-browser-runtime-test/22.23.1", browserVersion: "chromium-test/140.0", workerImageDigest: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" })
}

test("captureObservation executes an injected fixed observer and writes provenance bound to its exact commit", async (t) => {
  const root = await createGitRoot()
  const outputDirectory = path.join(root, "observation")
  const upstreamSha = await runGit(root, "rev-parse", "HEAD")
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = await captureObservation({
    repositoryRoot: root,
    upstreamSha,
    outputDirectory,
    runner: ({ outputDirectory: destination, upstreamSha: sha }) => writeFixtureObservation(destination, sha),
  })

  assert.equal(result.upstreamSha, upstreamSha)
  assert.equal(result.provenance.schemaVersion, 1)
  assert.equal(result.provenance.upstreamSha, upstreamSha)
  assert.equal(result.provenance.gitHead, upstreamSha)
  assert.equal(result.provenance.runtimeIdentitySha256.length, 64)
})

test("actual captureObservation provenance is accepted directly by prepareCorpus", async (t) => {
  const root = await createGitRoot()
  const outputDirectory = path.join(root, "captured-observation")
  const upstreamSha = await runGit(root, "rev-parse", "HEAD")
  const previousSha = "a".repeat(40)
  const sourceDirectory = path.join(root, "managed", "shared", "src")
  await mkdir(sourceDirectory, { recursive: true })
  await writeFile(path.join(root, "managed", "upstream.lock.json"), `${JSON.stringify({ schemaVersion: 1, lockStage: "CORPUS_LOCKED", upstreamRepository: "steel-dev/steel-browser", upstreamSha: previousSha, protocolCorpusSha256: "b".repeat(64), sessionIdVerdictSha256: "c".repeat(64) })}\n`)
  await writeFile(path.join(sourceDirectory, "upstream-observed-receipt.ts"), "const RECEIPT_SHA256_BY_UPSTREAM_SHA: ReadonlyMap<string, string> = new Map([\n])\n")
  const previousPlanDigest = process.env.STEEL_RUNTIME_CAPTURE_PLAN_SHA256
  process.env.STEEL_RUNTIME_CAPTURE_PLAN_SHA256 = "d".repeat(64)
  t.after(async () => {
    if (previousPlanDigest === undefined) delete process.env.STEEL_RUNTIME_CAPTURE_PLAN_SHA256
    else process.env.STEEL_RUNTIME_CAPTURE_PLAN_SHA256 = previousPlanDigest
    await rm(root, { recursive: true, force: true })
  })

  await captureObservation({ repositoryRoot: root, upstreamSha, outputDirectory, runner: ({ outputDirectory: destination, upstreamSha: sha }) => writeFixtureObservation(destination, sha) })
  const prepared = await prepareCorpus({ repositoryRoot: root, upstreamSha, observedCorpusDirectory: outputDirectory })

  assert.equal(prepared.upstreamSha, upstreamSha)
  assert.equal(JSON.parse(await readFile(path.join(root, "managed", "tests", "upstream", upstreamSha, "observation-provenance.json"))).capturePlanSha256, "d".repeat(64))
})

test("repository runner derives runtime identity from its process and fixed observer output", async (t) => {
  const root = await createGitRoot()
  const outputDirectory = path.join(root, "runner-observation")
  const upstreamSha = await runGit(root, "rev-parse", "HEAD")
  const runnerPath = path.resolve("scripts/upstream-sync/observation-runner.mjs")
  const observerPath = path.resolve("scripts/upstream-sync/steel-runtime-observer.mjs")
  const schemaPath = path.resolve("scripts/upstream-sync/corpus-schema.mjs")
  const routeSourcePath = path.resolve("scripts/upstream-sync/runtime-route-source.mjs")
  const probesPath = path.resolve("scripts/upstream-sync/runtime-probes.mjs")
  const corpusPath = path.resolve("scripts/upstream-sync/runtime-corpus.mjs")
  const planPath = path.resolve("managed/tests/upstream/c0f226b8e3b16d0bc2c76a222863d4db6f1aa8f2/route-matrix.json")
  const previousRunnerHash = process.env.STEEL_OBSERVATION_RUNNER_SHA256
  const previousObserverHash = process.env.STEEL_RUNTIME_OBSERVER_SHA256
  const previousSchemaHash = process.env.STEEL_CORPUS_SCHEMA_SHA256
  const previousRouteSourceHash = process.env.STEEL_RUNTIME_ROUTE_SOURCE_SHA256
  const previousProbesHash = process.env.STEEL_RUNTIME_PROBES_SHA256
  const previousCorpusHash = process.env.STEEL_RUNTIME_CORPUS_SHA256
  const previousPlanHash = process.env.STEEL_RUNTIME_CAPTURE_PLAN_SHA256
  const previousPlanPath = process.env.STEEL_RUNTIME_CAPTURE_PLAN_FILE
  process.env.STEEL_OBSERVATION_RUNNER_SHA256 = await sha256File(runnerPath)
  process.env.STEEL_RUNTIME_OBSERVER_SHA256 = await sha256File(observerPath)
  process.env.STEEL_CORPUS_SCHEMA_SHA256 = await sha256File(schemaPath)
  process.env.STEEL_RUNTIME_ROUTE_SOURCE_SHA256 = await sha256File(routeSourcePath)
  process.env.STEEL_RUNTIME_PROBES_SHA256 = await sha256File(probesPath)
  process.env.STEEL_RUNTIME_CORPUS_SHA256 = await sha256File(corpusPath)
  process.env.STEEL_RUNTIME_CAPTURE_PLAN_SHA256 = await sha256File(planPath)
  process.env.STEEL_RUNTIME_CAPTURE_PLAN_FILE = planPath
  t.after(async () => {
    if (previousRunnerHash === undefined) delete process.env.STEEL_OBSERVATION_RUNNER_SHA256
    else process.env.STEEL_OBSERVATION_RUNNER_SHA256 = previousRunnerHash
    if (previousObserverHash === undefined) delete process.env.STEEL_RUNTIME_OBSERVER_SHA256
    else process.env.STEEL_RUNTIME_OBSERVER_SHA256 = previousObserverHash
    if (previousSchemaHash === undefined) delete process.env.STEEL_CORPUS_SCHEMA_SHA256
    else process.env.STEEL_CORPUS_SCHEMA_SHA256 = previousSchemaHash
    if (previousRouteSourceHash === undefined) delete process.env.STEEL_RUNTIME_ROUTE_SOURCE_SHA256
    else process.env.STEEL_RUNTIME_ROUTE_SOURCE_SHA256 = previousRouteSourceHash
    if (previousProbesHash === undefined) delete process.env.STEEL_RUNTIME_PROBES_SHA256
    else process.env.STEEL_RUNTIME_PROBES_SHA256 = previousProbesHash
    if (previousCorpusHash === undefined) delete process.env.STEEL_RUNTIME_CORPUS_SHA256
    else process.env.STEEL_RUNTIME_CORPUS_SHA256 = previousCorpusHash
    if (previousPlanHash === undefined) delete process.env.STEEL_RUNTIME_CAPTURE_PLAN_SHA256
    else process.env.STEEL_RUNTIME_CAPTURE_PLAN_SHA256 = previousPlanHash
    if (previousPlanPath === undefined) delete process.env.STEEL_RUNTIME_CAPTURE_PLAN_FILE
    else process.env.STEEL_RUNTIME_CAPTURE_PLAN_FILE = previousPlanPath
    await rm(root, { recursive: true, force: true })
  })
  const result = await runRepositoryObservation({ repositoryRoot: root, upstreamSha, outputDirectory, observer: async () => completeObserverOutput(upstreamSha) })
  const identity = JSON.parse(await readFile(path.join(outputDirectory, "runtime-identity.json")))
  assert.equal(result, undefined)
  assert.equal(identity.gitHead, upstreamSha)
  assert.equal(identity.runtimeVersion, "v22.23.1")
  await assert.rejects(
    runRepositoryObservation({ repositoryRoot: root, upstreamSha, outputDirectory: path.join(root, "duplicate-coverage"), observer: async () => duplicateCoverageOutput(upstreamSha) }),
    /one or more runtime routes have no unique corpus observation/,
  )
})

test("captureObservation rejects a checked-out HEAD different from the requested source commit", async (t) => {
  const root = await createGitRoot()
  const targetSha = await runGit(root, "rev-parse", "HEAD")
  await writeFile(path.join(root, "second.txt"), "second\n")
  await runGit(root, "add", "second.txt")
  await runGit(root, "commit", "-qm", "second fixture commit")
  t.after(() => rm(root, { recursive: true, force: true }))
  await assert.rejects(captureObservation({ repositoryRoot: root, upstreamSha: targetSha, outputDirectory: path.join(root, "different-head"), runner: ({ outputDirectory: destination, upstreamSha: sha }) => writeFixtureObservation(destination, sha) }), /exact requested upstream SHA/)
})

test("captureObservation rejects runtime output with unknown files or a mismatched SHA", async (t) => {
  const root = await createGitRoot()
  const upstreamSha = await runGit(root, "rev-parse", "HEAD")
  t.after(() => rm(root, { recursive: true, force: true }))

  await assert.rejects(
    captureObservation({ repositoryRoot: root, upstreamSha, outputDirectory: path.join(root, "bad"), runner: async ({ outputDirectory: destination }) => writeFile(path.join(destination, "unknown.txt"), "bad\n") }),
    /unknown observation artifact|runtime identity is not pinned/,
  )
})
