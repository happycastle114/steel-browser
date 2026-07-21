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

const execFileAsync = promisify(execFile)
const runGit = async (root, ...args) => (await execFileAsync("git", ["-C", root, ...args])).stdout.trim()

test("runtime identity parser rejects static fabricated runtime fields", () => {
  const sha = "a".repeat(40)
  assert.throws(() => parseRuntimeIdentity(JSON.stringify({ schemaVersion: 1, upstreamSha: sha, gitHead: sha, runtimeVersion: "fixture", browserVersion: "chromium-test/140.0", workerImageDigest: `sha256:${"1".repeat(64)}` }), sha), /fabricated/)
})

test("production capture CLI rejects caller-selected executables and JSON input", async () => {
  await assert.rejects(execFileAsync(process.execPath, [path.resolve("scripts/upstream-sync/capture-observation.mjs"), "--upstream-sha", "a".repeat(40), "--output-directory", "/tmp/capture", "--runtime-executable", "/tmp/arbitrary"]), /caller-selected runtime executables are forbidden/)
})

test("default production runner blocks without real runtime prerequisites", async (t) => {
  const root = await createGitRoot()
  const upstreamSha = await runGit(root, "rev-parse", "HEAD")
  t.after(() => rm(root, { recursive: true, force: true }))
  await assert.rejects(captureObservation({ repositoryRoot: root, upstreamSha, outputDirectory: path.join(root, "blocked") }), (error) => error?.code === "RUNTIME_CAPTURE_BLOCKED")
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

test("repository runner derives runtime identity from its process and fixed observer output", async (t) => {
  const root = await createGitRoot()
  const outputDirectory = path.join(root, "runner-observation")
  const upstreamSha = await runGit(root, "rev-parse", "HEAD")
  const runnerPath = path.resolve("scripts/upstream-sync/observation-runner.mjs")
  const previousHash = process.env.STEEL_OBSERVATION_RUNNER_SHA256
  process.env.STEEL_OBSERVATION_RUNNER_SHA256 = createHash("sha256").update(await readFile(runnerPath)).digest("hex")
  t.after(async () => { if (previousHash === undefined) delete process.env.STEEL_OBSERVATION_RUNNER_SHA256; else process.env.STEEL_OBSERVATION_RUNNER_SHA256 = previousHash; await rm(root, { recursive: true, force: true }) })
  const names = ["manifest.json", "observed-receipt.json", "rest.ndjson", "route-matrix.json", "session-id-verdict.json", "websocket.ndjson"]
  const result = await runRepositoryObservation({ repositoryRoot: root, upstreamSha, outputDirectory, observer: async () => ({ browserVersion: "chromium-test/140.0", workerImageDigest: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", artifacts: names.map((name) => ({ path: name, text: "{}\n" })) }) })
  const identity = JSON.parse(await readFile(path.join(outputDirectory, "runtime-identity.json")))
  assert.equal(result, undefined)
  assert.equal(identity.gitHead, upstreamSha)
  assert.equal(identity.runtimeVersion, process.version)
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
