import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import test from "node:test"

import { MERGE_BLOCK_REASON, MERGE_STATUS, mergeCandidate } from "./merge-candidate.mjs"

const execFileAsync = promisify(execFile)
const git = async (root, ...args) => (await execFileAsync("git", ["-C", root, ...args])).stdout.trim()

test("disposable conflicting repository produces a typed block and restores managed exactly", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "steel-merge-conflict-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await git(root, "init", "-q")
  await git(root, "config", "user.name", "merge fixture")
  await git(root, "config", "user.email", "merge@example.invalid")
  await writeFile(path.join(root, "conflict.txt"), "base\n")
  await git(root, "add", "conflict.txt")
  await git(root, "commit", "-qm", "base")
  const baseSha = await git(root, "rev-parse", "HEAD")
  await git(root, "switch", "-qc", "source")
  await writeFile(path.join(root, "conflict.txt"), "source\n")
  await git(root, "commit", "-qam", "source")
  const sourceSha = await git(root, "rev-parse", "HEAD")
  await git(root, "switch", "-qc", "managed", baseSha)
  await writeFile(path.join(root, "conflict.txt"), "managed\n")
  await git(root, "commit", "-qam", "managed")
  const managedSha = await git(root, "rev-parse", "HEAD")
  assert.deepEqual(await mergeCandidate({ repositoryRoot: root, managedSha, sourceSha }), { status: MERGE_STATUS.BLOCKED, blockedReason: MERGE_BLOCK_REASON.MERGE_CONFLICT, managedSha, sourceSha })
  assert.equal(await git(root, "rev-parse", "HEAD"), managedSha)
  assert.equal(await git(root, "status", "--porcelain=v1", "--untracked-files=all"), "")
  assert.equal(await readFile(path.join(root, "conflict.txt"), "utf8"), "managed\n")
})
