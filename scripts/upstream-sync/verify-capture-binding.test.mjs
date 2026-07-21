import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import test from "node:test"

import { verifyCaptureBinding } from "./verify-capture-binding.mjs"

const execFileAsync = promisify(execFile)
const sha256 = (value) => createHash("sha256").update(value).digest("hex")
const git = async (root, ...args) => (await execFileAsync("git", ["-C", root, ...args])).stdout.trim()

async function writeFullCorpus(root, sourceSha, marker) {
  const directory = path.join(root, "managed", "tests", "upstream", sourceSha)
  await mkdir(directory, { recursive: true })
  const files = {
    "manifest.json": `${JSON.stringify({ schemaVersion: 1, upstreamSha: sourceSha, marker })}\n`,
    "observed-receipt.json": `${JSON.stringify({ schemaVersion: 1, upstreamSha: sourceSha, marker })}\n`,
    "rest.ndjson": Array.from({ length: 37 }, (_, index) => JSON.stringify({ id: `${marker}.rest.${index}` })).join("\n") + "\n",
    "route-matrix.json": `${JSON.stringify({ schemaVersion: 1, upstreamSha: sourceSha, marker, routes: Array.from({ length: 42 }) })}\n`,
    "runtime-identity.json": `${JSON.stringify({ schemaVersion: 1, upstreamSha: sourceSha, marker })}\n`,
    "session-id-verdict.json": `${JSON.stringify({ schemaVersion: 1, upstreamSha: sourceSha, marker })}\n`,
    "websocket.ndjson": Array.from({ length: 5 }, (_, index) => JSON.stringify({ id: `${marker}.ws.${index}` })).join("\n") + "\n",
  }
  const artifacts = []
  for (const [name, text] of Object.entries(files)) {
    await writeFile(path.join(directory, name), text)
    artifacts.push({ path: name, sha256: sha256(text) })
  }
  const provenance = `${JSON.stringify({ schemaVersion: 1, upstreamSha: sourceSha, gitHead: sourceSha, artifacts }, null, 2)}\n`
  await writeFile(path.join(directory, "observation-provenance.json"), provenance)
  return provenance
}

test("publisher binding rejects a source-consistent full corpus replacement after untrusted gates", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "steel-capture-binding-"))
  const bindingPath = path.join(root, "capture-binding.json")
  const sourceSha = "a".repeat(40)
  t.after(() => rm(root, { recursive: true, force: true }))
  await git(root, "init", "-q")
  await git(root, "config", "user.name", "binding-fixture")
  await git(root, "config", "user.email", "binding@example.invalid")
  const provenance = await writeFullCorpus(root, sourceSha, "captured")
  await writeFile(bindingPath, provenance)
  await git(root, "add", "managed")
  await git(root, "commit", "-qm", "captured corpus")
  const capturedCommit = await git(root, "rev-parse", "HEAD")
  assert.equal((await verifyCaptureBinding({ repositoryRoot: root, commitSha: capturedCommit, sourceSha, bindingPath })).status, "VERIFIED")

  await writeFullCorpus(root, sourceSha, "forged-by-npm-test")
  await git(root, "add", "managed")
  await git(root, "commit", "-qm", "replace complete 37 REST and 5 WebSocket corpus")
  const forgedCommit = await git(root, "rev-parse", "HEAD")
  await assert.rejects(verifyCaptureBinding({ repositoryRoot: root, commitSha: forgedCommit, sourceSha, bindingPath }), /differs from pre-untrusted capture/)
})
