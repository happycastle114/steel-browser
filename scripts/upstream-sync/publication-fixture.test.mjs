import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import test from "node:test"

import { verifyCandidateCommit } from "./verify-candidate-commit.mjs"

const execFileAsync = promisify(execFile)
const runGit = async (root, ...args) => (await execFileAsync("git", ["-C", root, ...args])).stdout.trim()

async function commit(root, message) {
  await runGit(root, "add", "--all")
  await runGit(root, "commit", "-m", message)
  return runGit(root, "rev-parse", "HEAD")
}

async function writeCorpus(root, sourceSha, mergeSha, managedSha, diffSha256) {
  const directory = path.join(root, "managed", "tests", "upstream", sourceSha)
  await mkdir(directory, { recursive: true })
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`
  const files = {
    "manifest.json": json({ schemaVersion: 1, upstreamSha: sourceSha, sources: [], artifacts: [] }),
    "observed-receipt.json": json({ schemaVersion: 1, upstreamSha: sourceSha, routeMatrixSha256: "0".repeat(64), sessionIdVerdictSha256: "0".repeat(64) }),
    "rest.ndjson": "rest\n",
    "route-matrix.json": json({ schemaVersion: 1, upstreamSha: sourceSha, routes: [] }),
    "session-id-verdict.json": json({ schemaVersion: 1, upstreamSha: sourceSha, mode: "CLIENT_SUPPLIED" }),
    "websocket.ndjson": "websocket\n",
    "runtime-identity.json": json({ schemaVersion: 1, upstreamSha: sourceSha, runtimeVersion: "fixture", browserVersion: "fixture", workerImageDigest: `sha256:${"1".repeat(64)}` }),
  }
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(directory, name), text)
  const artifacts = Object.entries(files).map(([name, text]) => ({ path: name, sha256: createHash("sha256").update(text).digest("hex") }))
  await writeFile(path.join(directory, "observation-provenance.json"), json({
    schemaVersion: 1,
    upstreamSha: sourceSha,
    gitHead: sourceSha,
    captureToolVersion: "fixture",
    capturedAt: "2026-01-01T00:00:00.000Z",
    runtimeExecutable: "fixture",
    runtimeArgs: [],
    runtimeIdentitySha256: createHash("sha256").update(files["runtime-identity.json"]).digest("hex"),
    artifacts,
  }))
  const classification = {
    schemaVersion: 1,
    sourceSha,
    managedSha,
    mergeSha,
    lockSha: "a".repeat(40),
    requiresObservation: true,
    observationAvailable: true,
    changedPaths: ["api.txt"],
    categories: ["API"],
    diffSha256,
    blocked: false,
    blockedReasons: [],
  }
  await writeFile(path.join(directory, "classification.json"), json(classification))
}

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "steel-publication-fixture-"))
  await runGit(root, "init", "-q")
  await runGit(root, "config", "user.name", "fixture")
  await runGit(root, "config", "user.email", "fixture@example.invalid")
  await mkdir(path.join(root, "managed", "shared", "src"), { recursive: true })
  await writeFile(path.join(root, "managed", "upstream.lock.json"), JSON.stringify({ schemaVersion: 1, lockStage: "CORPUS_LOCKED", upstreamSha: "a".repeat(40) }) + "\n")
  await writeFile(path.join(root, "managed", "shared", "src", "upstream-observed-receipt.ts"), "const RECEIPT_SHA256_BY_UPSTREAM_SHA = new Map([])\n")
  const managedSha = await commit(root, "managed baseline")
  await runGit(root, "switch", "-c", "source")
  await writeFile(path.join(root, "api.txt"), "upstream\n")
  await commit(root, "upstream source")
  const sourceSha = await runGit(root, "rev-parse", "HEAD")
  await runGit(root, "switch", "--detach", managedSha)
  await runGit(root, "merge", "--no-edit", "--no-ff", sourceSha)
  const mergeSha = await runGit(root, "rev-parse", "HEAD")
  const diffBytes = Buffer.from((await execFileAsync("git", ["-C", root, "diff", "--binary", "--no-ext-diff", `${managedSha}...${sourceSha}`])).stdout, "utf8")
  const diffSha256 = createHash("sha256").update(diffBytes).digest("hex")
  await writeFile(path.join(root, "managed", "upstream.lock.json"), JSON.stringify({ schemaVersion: 1, lockStage: "CORPUS_LOCKED", upstreamSha: sourceSha }) + "\n")
  await writeFile(path.join(root, "managed", "shared", "src", "upstream-observed-receipt.ts"), `const RECEIPT_SHA256_BY_UPSTREAM_SHA = new Map([["${sourceSha}", "${"0".repeat(64)}"]])\n`)
  await writeCorpus(root, sourceSha, mergeSha, managedSha, diffSha256)
  const generatedSha = await commit(root, "ci(managed): record observed upstream corpus")
  const treeSha = await runGit(root, "rev-parse", `${generatedSha}^{tree}`)
  return { root, managedSha, sourceSha, mergeSha, generatedSha, treeSha }
}

test("publication fixture accepts only the exact merge plus generated commit topology", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  const result = await verifyCandidateCommit({
    repositoryRoot: fixture.root,
    commitSha: fixture.generatedSha,
    mergeCommitSha: fixture.mergeSha,
    managedSha: fixture.managedSha,
    sourceSha: fixture.sourceSha,
    treeSha: fixture.treeSha,
  })
  assert.equal(result.status, "VERIFIED")
})

test("publication fixture rejects a generated commit that self-modifies workflow policy", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  await runGit(fixture.root, "switch", "--detach", fixture.mergeSha)
  await runGit(fixture.root, "restore", "--source", fixture.generatedSha, "--", "managed")
  await mkdir(path.join(fixture.root, ".github"), { recursive: true })
  await writeFile(path.join(fixture.root, ".github", "CODEOWNERS"), "* @untrusted\n")
  const badSha = await commit(fixture.root, "bad generated commit")
  const badTree = await runGit(fixture.root, "rev-parse", `${badSha}^{tree}`)
  await assert.rejects(
    verifyCandidateCommit({
      repositoryRoot: fixture.root,
      commitSha: badSha,
      mergeCommitSha: fixture.mergeSha,
      managedSha: fixture.managedSha,
      sourceSha: fixture.sourceSha,
      treeSha: badTree,
    }),
    /candidate generated path allowlist mismatch/,
  )
})

test("publication fixture rejects a candidate whose managed base is stale", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  await assert.rejects(
    verifyCandidateCommit({
      repositoryRoot: fixture.root,
      commitSha: fixture.generatedSha,
      mergeCommitSha: fixture.mergeSha,
      managedSha: "c".repeat(40),
      sourceSha: fixture.sourceSha,
      treeSha: fixture.treeSha,
    }),
    /candidate merge parents are not the exact managed\/source pair/,
  )
})
