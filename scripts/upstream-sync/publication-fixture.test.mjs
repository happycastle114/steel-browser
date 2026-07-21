import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import test from "node:test"

import { verifyCandidateCommit } from "./verify-candidate-commit.mjs"
import { sha256 } from "./prepare-corpus.mjs"

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
  const ndjson = (value) => `${JSON.stringify(value)}\n`
  const restRoute = { protocol: "REST", id: "rest.fixture", method: "GET", path: "/v1/fixture", source: "api.txt", runtimeCondition: "ALWAYS", affinity: "NONE", lifecycle: "READ", mutating: false, implicitHead: true, expected: { statuses: [200], contentTypes: ["application/json"], headers: ["content-type"], urlFields: [] } }
  const webSocketRoute = { protocol: "WEBSOCKET", id: "ws.fixture", path: "/fixture", source: "api.txt", runtimeCondition: "ALWAYS", affinity: "NONE", lifecycle: "WEBSOCKET", mutating: false, upgradeClass: "LOGS", expectedCloseCodes: [1000] }
  const restRecord = { schemaVersion: 1, id: "record.rest.fixture", routeId: "rest.fixture", scenario: "fixture", request: { method: "GET", path: "/v1/fixture", bodyKind: "EMPTY" }, response: { status: 200, contentType: "application/json", headers: { "content-type": "application/json" }, bodyKind: "JSON", bodySha256: "1".repeat(64), urlFields: {} } }
  const webSocketRecord = { schemaVersion: 1, id: "record.ws.fixture", routeId: "ws.fixture", scenario: "fixture", requestPath: "/fixture", opened: true, messageKind: "OPEN_NO_MESSAGE", closeCode: 1000 }
  const restText = ndjson(restRecord)
  const webSocketText = ndjson(webSocketRecord)
  const routeMatrixText = json({ schemaVersion: 1, upstreamSha: sourceSha, runtimeProfile: { nodeEnv: "development", logStorageEnabled: true }, routes: [restRoute, webSocketRoute] })
  const sessionIdVerdictText = json({ schemaVersion: 1, upstreamSha: sourceSha, mode: "CLIENT_SUPPLIED", callerSessionId: "11111111-2222-4333-8444-555555555555", createReturnedCallerId: true, freshConnectionListRecoveredActiveId: true, freshConnectionGetRecoveredActiveId: true, releaseReturnedActiveId: true, createJournalBinding: "CLIENT_ID_DIRECT" })
  const files = {
    "rest.ndjson": restText,
    "route-matrix.json": routeMatrixText,
    "session-id-verdict.json": sessionIdVerdictText,
    "websocket.ndjson": webSocketText,
    "runtime-identity.json": json({ schemaVersion: 1, upstreamSha: sourceSha, gitHead: sourceSha, runtimeVersion: "steel-browser-runtime-test/22.23.1", browserVersion: "chromium-test/140.0", workerImageDigest: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" }),
  }
  files["manifest.json"] = json({ schemaVersion: 1, upstreamSha: sourceSha, sessionIdMode: "CLIENT_SUPPLIED", sourceInventorySha256: "2".repeat(64), sources: [{ path: "api.txt", sha256: sha256("upstream\n") }], artifacts: [
    { path: "rest.ndjson", sha256: sha256(restText), records: 1 },
    { path: "websocket.ndjson", sha256: sha256(webSocketText), records: 1 },
    { path: "route-matrix.json", sha256: sha256(routeMatrixText), records: 2 },
    { path: "session-id-verdict.json", sha256: sha256(sessionIdVerdictText), records: 1 },
  ], restRouteCount: 1, webSocketRouteCount: 1 })
  files["observed-receipt.json"] = json({ schemaVersion: 1, upstreamSha: sourceSha, routeMatrixSha256: sha256(routeMatrixText), sessionIdVerdictSha256: sha256(sessionIdVerdictText), rest: [{ id: restRecord.id, routeId: restRecord.routeId, request: { method: restRecord.request.method, path: restRecord.request.path }, response: { status: restRecord.response.status, contentType: restRecord.response.contentType, headers: restRecord.response.headers, bodySha256: restRecord.response.bodySha256, urlFields: restRecord.response.urlFields } }], webSocket: [{ id: webSocketRecord.id, routeId: webSocketRecord.routeId, requestPath: webSocketRecord.requestPath, opened: true, messageKind: webSocketRecord.messageKind, closeCode: webSocketRecord.closeCode }] })
  const artifacts = Object.entries(files).map(([name, text]) => ({ path: name, sha256: createHash("sha256").update(text).digest("hex") }))
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(directory, name), text)
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
    categories: [],
    diffSha256,
    reviewAcknowledgement: null,
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
  await writeCorpus(root, sourceSha, mergeSha, managedSha, diffSha256)
  const manifestText = await readFile(path.join(root, "managed", "tests", "upstream", sourceSha, "manifest.json"), "utf8")
  const sessionText = await readFile(path.join(root, "managed", "tests", "upstream", sourceSha, "session-id-verdict.json"), "utf8")
  await writeFile(path.join(root, "managed", "upstream.lock.json"), JSON.stringify({ schemaVersion: 1, lockStage: "CORPUS_LOCKED", upstreamSha: sourceSha, protocolCorpusSha256: sha256(manifestText), sessionIdVerdictSha256: sha256(sessionText) }) + "\n")
  const receiptText = await readFile(path.join(root, "managed", "tests", "upstream", sourceSha, "observed-receipt.json"), "utf8")
  await writeFile(path.join(root, "managed", "shared", "src", "upstream-observed-receipt.ts"), `const RECEIPT_SHA256_BY_UPSTREAM_SHA = new Map([["${sourceSha}", "${sha256(receiptText)}"]])\n`)
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

test("publication fixture rejects a candidate that replaces allowed evidence with junk bytes", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  await runGit(fixture.root, "switch", "--detach", fixture.mergeSha)
  await runGit(fixture.root, "restore", "--source", fixture.generatedSha, "--", "managed")
  const corpusDirectory = path.join(fixture.root, "managed", "tests", "upstream", fixture.sourceSha)
  for (const fileName of ["manifest.json", "observed-receipt.json", "rest.ndjson", "route-matrix.json", "session-id-verdict.json", "websocket.ndjson", "runtime-identity.json", "observation-provenance.json"]) {
    await writeFile(path.join(corpusDirectory, fileName), "not evidence\n")
  }
  const badSha = await commit(fixture.root, "bad evidence bytes")
  const badTree = await runGit(fixture.root, "rev-parse", `${badSha}^{tree}`)
  await assert.rejects(
    verifyCandidateCommit({ repositoryRoot: fixture.root, commitSha: badSha, mergeCommitSha: fixture.mergeSha, managedSha: fixture.managedSha, sourceSha: fixture.sourceSha, treeSha: badTree }),
    /observed|manifest|JSON|provenance|schema/i,
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
