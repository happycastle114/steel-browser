import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import test from "node:test"

const execFileAsync = promisify(execFile)
const runGit = async (root, ...args) => (await execFileAsync("git", ["-C", root, ...args])).stdout.trim()
const SOURCE_SHA = "b".repeat(40)

async function commit(root, message) {
  await runGit(root, "add", "--all")
  await runGit(root, "commit", "-m", message)
  return runGit(root, "rev-parse", "HEAD")
}

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "steel-publication-fixture-"))
  await runGit(root, "init", "-q")
  await runGit(root, "config", "user.name", "fixture")
  await runGit(root, "config", "user.email", "fixture@example.invalid")
  await mkdir(path.join(root, "managed", "tests", "upstream", SOURCE_SHA), { recursive: true })
  await writeFile(path.join(root, "managed", "upstream.lock.json"), "old\n")
  await writeFile(path.join(root, "managed", "shared-receipt.ts"), "old\n")
  await writeFile(path.join(root, "managed", "tests", "upstream", SOURCE_SHA, "observed-receipt.json"), "old\n")
  const managedSha = await commit(root, "managed baseline")
  await runGit(root, "switch", "-c", "source")
  await writeFile(path.join(root, "api.txt"), "upstream\n")
  await commit(root, "upstream source")
  const sourceSha = await runGit(root, "rev-parse", "HEAD")
  await runGit(root, "switch", "--detach", managedSha)
  await runGit(root, "merge", "--no-edit", "--no-ff", sourceSha)
  const mergeSha = await runGit(root, "rev-parse", "HEAD")
  await writeFile(path.join(root, "managed", "upstream.lock.json"), "new\n")
  await writeFile(path.join(root, "managed", "shared-receipt.ts"), "new\n")
  await writeFile(path.join(root, "managed", "tests", "upstream", SOURCE_SHA, "observed-receipt.json"), "new\n")
  const generatedSha = await commit(root, "ci(managed): record observed upstream corpus")
  return { root, managedSha, sourceSha, mergeSha, generatedSha }
}

function assertGeneratedCommit(root, managedSha, generatedSha, mergeSha, sourceSha) {
  return Promise.all([
    runGit(root, "rev-list", "--parents", "-n", "1", generatedSha).then((line) => {
      const [commitSha, parent, extra] = line.split(" ")
      assert.equal(commitSha, generatedSha)
      assert.equal(parent, mergeSha)
      assert.equal(extra, undefined)
    }),
    runGit(root, "rev-list", "--parents", "-n", "1", mergeSha).then((line) => {
      const [commitSha, parentOne, parentTwo, extra] = line.split(" ")
      assert.equal(commitSha, mergeSha)
      assert.equal(parentOne, managedSha)
      assert.equal(parentTwo, sourceSha)
      assert.equal(extra, undefined)
    }),
  ])
}

test("publication fixture accepts only the exact merge plus generated commit topology", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))

  await assertGeneratedCommit(fixture.root, fixture.managedSha, fixture.generatedSha, fixture.mergeSha, fixture.sourceSha)
  const paths = (await runGit(fixture.root, "diff-tree", "--no-commit-id", "--name-only", "-r", fixture.generatedSha)).split("\n").sort()
  assert.deepEqual(paths, [
    "managed/shared-receipt.ts",
    "managed/tests/upstream/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/observed-receipt.json",
    "managed/upstream.lock.json",
  ].sort())
})

test("publication fixture rejects a generated commit that self-modifies workflow policy", async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  await mkdir(path.join(fixture.root, ".github", "workflows"), { recursive: true })
  await writeFile(path.join(fixture.root, ".github", "workflows", "upstream-sync.yml"), "bad\n")
  const badSha = await commit(fixture.root, "bad generated commit")
  const paths = (await runGit(fixture.root, "diff-tree", "--no-commit-id", "--name-only", "-r", badSha)).split("\n")
  assert.ok(paths.includes(".github/workflows/upstream-sync.yml"))
  assert.throws(
    () => paths.forEach((entry) => {
      if (entry === ".github/workflows/upstream-sync.yml") throw new Error("workflow file may not be part of generated candidate changes")
    }),
    /workflow file may not be part of generated candidate changes/,
  )
})
