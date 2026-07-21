import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import test from "node:test"

import { recordBlockedCandidate } from "./record-blocked-candidate.mjs"

const execFileAsync = promisify(execFile)
const git = async (root, ...args) => (await execFileAsync("git", ["-C", root, ...args])).stdout.trim()

test("capture block records complete classification, metadata, and blocked workflow output", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "steel-blocked-candidate-"))
  const artifactRoot = path.join(root, "artifacts")
  const githubOutput = path.join(root, "github-output")
  t.after(() => rm(root, { recursive: true, force: true }))
  await git(root, "init", "-q")
  await git(root, "config", "user.name", "blocked-fixture")
  await git(root, "config", "user.email", "blocked@example.invalid")
  await writeFile(path.join(root, "README.md"), "managed\n")
  await git(root, "add", "README.md")
  await git(root, "commit", "-qm", "managed")
  const managedSha = await git(root, "rev-parse", "HEAD")
  await git(root, "switch", "-qc", "source")
  await writeFile(path.join(root, "api.txt"), "upstream route\n")
  await git(root, "add", "api.txt")
  await git(root, "commit", "-qm", "source")
  const sourceSha = await git(root, "rev-parse", "HEAD")
  await git(root, "switch", "--detach", managedSha)

  const result = await recordBlockedCandidate({ repositoryRoot: root, artifactRoot, githubOutput, managedSha, sourceSha, lockSha: managedSha })
  const classification = JSON.parse(await readFile(path.join(artifactRoot, "classification.json"), "utf8"))
  const metadata = JSON.parse(await readFile(path.join(artifactRoot, "candidate-metadata.json"), "utf8"))
  assert.equal(result.classification.observationAvailable, false)
  assert.equal(classification.blocked, true)
  assert.ok(classification.blockedReasons.includes("OBSERVED_CORPUS_REQUIRED"))
  assert.equal(classification.upstreamTraceability.status, "FOUND")
  assert.deepEqual(classification.upstreamTraceability.commits, [{ sha: sourceSha, subject: "source" }])
  assert.deepEqual(classification.upstreamTraceability.releaseNotes, { status: "NOT_FOUND", paths: [] })
  assert.deepEqual(classification.upstreamTraceability.migrationNotes, { status: "NOT_FOUND", paths: [] })
  assert.deepEqual(metadata, { schemaVersion: 1, status: "BLOCKED", sourceSha, managedSha })
  assert.equal(await readFile(githubOutput, "utf8"), "sync_status=blocked\n")
})

test("blocked candidate preserves an explicit typed merge conflict reason", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "steel-blocked-conflict-"))
  const artifactRoot = path.join(root, "artifacts")
  const githubOutput = path.join(root, "github-output")
  t.after(() => rm(root, { recursive: true, force: true }))
  await git(root, "init", "-q")
  await git(root, "config", "user.name", "blocked-fixture")
  await git(root, "config", "user.email", "blocked@example.invalid")
  await writeFile(path.join(root, "README.md"), "managed\n")
  await git(root, "add", "README.md")
  await git(root, "commit", "-qm", "managed")
  const managedSha = await git(root, "rev-parse", "HEAD")
  await git(root, "switch", "-qc", "source")
  await writeFile(path.join(root, "README.md"), "source\n")
  await git(root, "add", "README.md")
  await git(root, "commit", "-qm", "source")
  const sourceSha = await git(root, "rev-parse", "HEAD")
  await git(root, "switch", "--detach", managedSha)
  const result = await recordBlockedCandidate({ repositoryRoot: root, artifactRoot, githubOutput, managedSha, sourceSha, lockSha: managedSha, observationAvailable: true, blockedReason: "MERGE_CONFLICT" })
  assert.equal(result.classification.blocked, true)
  assert.deepEqual(result.classification.blockedReasons, ["MERGE_CONFLICT"])
})
