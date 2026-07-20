import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import test from "node:test"

import { captureObservation } from "./capture-observation.mjs"

const execFileAsync = promisify(execFile)
const runGit = async (root, ...args) => (await execFileAsync("git", ["-C", root, ...args])).stdout.trim()

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

test("captureObservation executes a runtime command and writes provenance bound to its exact commit", async (t) => {
  const root = await createGitRoot()
  const outputDirectory = path.join(root, "observation")
  const runtimeScript = path.join(root, "runtime-capture.mjs")
  const upstreamSha = await runGit(root, "rev-parse", "HEAD")
  await writeFile(runtimeScript, `import { mkdir, writeFile } from "node:fs/promises"; const d = process.env.STEEL_OBSERVATION_OUTPUT_DIR; await mkdir(d, { recursive: true }); const sha = process.env.STEEL_OBSERVATION_UPSTREAM_SHA; const json = (v) => writeFile(new URL(v[0], "file://" + d + "/").pathname, JSON.stringify(v[1]) + "\\n"); await json(["manifest.json", { schemaVersion: 1, upstreamSha: sha, artifacts: [] }]); await json(["observed-receipt.json", { schemaVersion: 1, upstreamSha: sha, routeMatrixSha256: "0".repeat(64), sessionIdVerdictSha256: "0".repeat(64) }]); await json(["route-matrix.json", { schemaVersion: 1, upstreamSha: sha, routes: [] }]); await json(["session-id-verdict.json", { schemaVersion: 1, upstreamSha: sha, mode: "CLIENT_SUPPLIED" }]); await writeFile(new URL("rest.ndjson", "file://" + d + "/").pathname, "rest\\n"); await writeFile(new URL("websocket.ndjson", "file://" + d + "/").pathname, "ws\\n"); await json(["runtime-identity.json", { schemaVersion: 1, upstreamSha: sha, runtimeVersion: "fixture", browserVersion: "fixture", workerImageDigest: "sha256:" + "1".repeat(64) }]);`)
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = await captureObservation({
    repositoryRoot: root,
    upstreamSha,
    outputDirectory,
    runtimeExecutable: process.execPath,
    runtimeArgs: [runtimeScript],
  })

  assert.equal(result.upstreamSha, upstreamSha)
  assert.equal(result.provenance.schemaVersion, 1)
  assert.equal(result.provenance.upstreamSha, upstreamSha)
  assert.equal(result.provenance.runtimeIdentitySha256.length, 64)
})

test("captureObservation rejects runtime output with unknown files or a mismatched SHA", async (t) => {
  const root = await createGitRoot()
  const runtimeScript = path.join(root, "runtime-capture-bad.mjs")
  const upstreamSha = await runGit(root, "rev-parse", "HEAD")
  await writeFile(runtimeScript, `import { mkdir, writeFile } from "node:fs/promises"; const d = process.env.STEEL_OBSERVATION_OUTPUT_DIR; await mkdir(d, { recursive: true }); await writeFile(d + "/unknown.txt", "bad\\n"); await writeFile(d + "/runtime-identity.json", JSON.stringify({ schemaVersion: 1, upstreamSha: "${"f".repeat(40)}" }));`)
  t.after(() => rm(root, { recursive: true, force: true }))

  await assert.rejects(
    captureObservation({ repositoryRoot: root, upstreamSha, outputDirectory: path.join(root, "bad"), runtimeExecutable: process.execPath, runtimeArgs: [runtimeScript] }),
    /unknown observation artifact|runtime identity is not pinned/,
  )
})
