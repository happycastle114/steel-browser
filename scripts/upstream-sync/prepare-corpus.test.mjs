import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { prepareCorpus, sha256 } from "./prepare-corpus.mjs"

const OLD_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const NEW_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

async function createCorpusRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "steel-upstream-sync-"))
  const oldDirectory = path.join(root, "managed", "tests", "upstream", OLD_SHA)
  const sourceDirectory = path.join(root, "managed", "shared", "src")
  await mkdir(oldDirectory, { recursive: true })
  await mkdir(sourceDirectory, { recursive: true })
  await writeFile(
    path.join(sourceDirectory, "upstream-observed-receipt.ts"),
    `const RECEIPT_SHA256_BY_UPSTREAM_SHA: ReadonlyMap<string, string> = new Map([\n  ["${OLD_SHA}", "${"e".repeat(64)}"],\n])\n`,
  )
  await writeFile(
    path.join(root, "managed", "upstream.lock.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      lockStage: "CORPUS_LOCKED",
      upstreamRepository: "steel-dev/steel-browser",
      upstreamSha: OLD_SHA,
      protocolCorpusSha256: "c".repeat(64),
      sessionIdVerdictSha256: "d".repeat(64),
    }, null, 2)}\n`,
  )
  await writeFile(
    path.join(oldDirectory, "manifest.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      upstreamSha: OLD_SHA,
      sources: [],
      artifacts: [
        { path: "route-matrix.json", sha256: "0".repeat(64), records: 0 },
        { path: "session-id-verdict.json", sha256: "0".repeat(64), records: 1 },
      ],
    }, null, 2)}\n`,
  )
  await writeFile(
    path.join(oldDirectory, "route-matrix.json"),
    `${JSON.stringify({ schemaVersion: 1, upstreamSha: OLD_SHA, routes: [] }, null, 2)}\n`,
  )
  await writeFile(
    path.join(oldDirectory, "session-id-verdict.json"),
    `${JSON.stringify({ schemaVersion: 1, upstreamSha: OLD_SHA }, null, 2)}\n`,
  )
  await writeFile(
    path.join(oldDirectory, "observed-receipt.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      upstreamSha: OLD_SHA,
      routeMatrixSha256: "0".repeat(64),
      sessionIdVerdictSha256: "0".repeat(64),
    }, null, 2)}\n`,
  )
  await writeFile(path.join(oldDirectory, "rest.ndjson"), "record\n")
  return root
}

test("prepareCorpus copies the locked corpus and rewrites every upstream SHA", async (t) => {
  const root = await createCorpusRepository()
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = await prepareCorpus({ repositoryRoot: root, upstreamSha: NEW_SHA })

  assert.equal(result.previousUpstreamSha, OLD_SHA)
  assert.equal(result.upstreamSha, NEW_SHA)
  const manifest = JSON.parse(await readFile(path.join(root, "managed", "tests", "upstream", NEW_SHA, "manifest.json"), "utf8"))
  const manifestText = await readFile(path.join(root, "managed", "tests", "upstream", NEW_SHA, "manifest.json"), "utf8")
  const observedReceipt = JSON.parse(await readFile(path.join(root, "managed", "tests", "upstream", NEW_SHA, "observed-receipt.json"), "utf8"))
  const matrix = JSON.parse(await readFile(path.join(root, "managed", "tests", "upstream", NEW_SHA, "route-matrix.json"), "utf8"))
  const matrixText = await readFile(path.join(root, "managed", "tests", "upstream", NEW_SHA, "route-matrix.json"), "utf8")
  const sessionText = await readFile(path.join(root, "managed", "tests", "upstream", NEW_SHA, "session-id-verdict.json"), "utf8")
  const lock = JSON.parse(await readFile(path.join(root, "managed", "upstream.lock.json"), "utf8"))
  assert.equal(manifest.upstreamSha, NEW_SHA)
  assert.equal(matrix.upstreamSha, NEW_SHA)
  assert.equal(lock.upstreamSha, NEW_SHA)
  assert.equal(manifest.artifacts.find((artifact) => artifact.path === "route-matrix.json").sha256, sha256(matrixText))
  assert.equal(manifest.artifacts.find((artifact) => artifact.path === "session-id-verdict.json").sha256, sha256(sessionText))
  assert.equal(observedReceipt.routeMatrixSha256, sha256(matrixText))
  assert.equal(observedReceipt.sessionIdVerdictSha256, sha256(sessionText))
  assert.equal(lock.protocolCorpusSha256, sha256(manifestText))
  assert.equal(lock.sessionIdVerdictSha256, sha256(sessionText))
  assert.match(
    await readFile(path.join(root, "managed", "shared", "src", "upstream-observed-receipt.ts"), "utf8"),
    new RegExp(`\\["${NEW_SHA}",\\s*"[0-9a-f]{64}"\\]`),
  )
  assert.match(await readFile(path.join(root, "managed", "tests", "upstream", NEW_SHA, "rest.ndjson"), "utf8"), /record/)
})

test("prepareCorpus rejects an existing destination with different bytes", async (t) => {
  const root = await createCorpusRepository()
  t.after(() => rm(root, { recursive: true, force: true }))

  await mkdir(path.join(root, "managed", "tests", "upstream", NEW_SHA), { recursive: true })
  await writeFile(path.join(root, "managed", "tests", "upstream", NEW_SHA, "manifest.json"), "different\n")
  await assert.rejects(
    prepareCorpus({ repositoryRoot: root, upstreamSha: NEW_SHA }),
    /destination corpus already exists/,
  )
})
