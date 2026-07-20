import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile, mkdir, cp, readdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { prepareCorpus, sha256 } from "./prepare-corpus.mjs"

const OLD_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const NEW_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

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
    json({
      schemaVersion: 1,
      lockStage: "CORPUS_LOCKED",
      upstreamRepository: "steel-dev/steel-browser",
      upstreamSha: OLD_SHA,
      protocolCorpusSha256: "c".repeat(64),
      sessionIdVerdictSha256: "d".repeat(64),
    }),
  )
  await writeFile(path.join(oldDirectory, "manifest.json"), json({ schemaVersion: 1, upstreamSha: OLD_SHA, sources: [], artifacts: [] }))
  await writeFile(path.join(oldDirectory, "route-matrix.json"), json({ schemaVersion: 1, upstreamSha: OLD_SHA, routes: [] }))
  await writeFile(path.join(oldDirectory, "session-id-verdict.json"), json({ schemaVersion: 1, upstreamSha: OLD_SHA, mode: "CLIENT_SUPPLIED" }))
  await writeFile(
    path.join(oldDirectory, "observed-receipt.json"),
    json({ schemaVersion: 1, upstreamSha: OLD_SHA, routeMatrixSha256: "0".repeat(64), sessionIdVerdictSha256: "0".repeat(64) }),
  )
  await writeFile(path.join(oldDirectory, "rest.ndjson"), "record\n")
  await writeFile(path.join(oldDirectory, "websocket.ndjson"), "record\n")
  return root
}

async function createObservedCorpus(root) {
  const sourceDirectory = path.join(root, "observed", NEW_SHA)
  await mkdir(sourceDirectory, { recursive: true })
  await writeFile(path.join(sourceDirectory, "manifest.json"), json({ schemaVersion: 1, upstreamSha: NEW_SHA, sources: [], artifacts: [] }))
  await writeFile(path.join(sourceDirectory, "route-matrix.json"), json({ schemaVersion: 1, upstreamSha: NEW_SHA, routes: [] }))
  await writeFile(path.join(sourceDirectory, "session-id-verdict.json"), json({ schemaVersion: 1, upstreamSha: NEW_SHA, mode: "CLIENT_SUPPLIED" }))
  await writeFile(
    path.join(sourceDirectory, "observed-receipt.json"),
    json({ schemaVersion: 1, upstreamSha: NEW_SHA, routeMatrixSha256: "0".repeat(64), sessionIdVerdictSha256: "0".repeat(64) }),
  )
  await writeFile(path.join(sourceDirectory, "rest.ndjson"), "captured-rest\n")
  await writeFile(path.join(sourceDirectory, "websocket.ndjson"), "captured-websocket\n")
  await writeFile(path.join(sourceDirectory, "runtime-identity.json"), json({
    schemaVersion: 1,
    upstreamSha: NEW_SHA,
    runtimeVersion: "fixture-runtime",
    browserVersion: "fixture-browser",
    workerImageDigest: `sha256:${"1".repeat(64)}`,
  }))
  await writeObservedProvenance(sourceDirectory)
  return sourceDirectory
}

async function writeObservedProvenance(directory) {
  const artifactNames = [
    "manifest.json",
    "observed-receipt.json",
    "rest.ndjson",
    "route-matrix.json",
    "session-id-verdict.json",
    "websocket.ndjson",
    "runtime-identity.json",
  ]
  for (const optionalName of ["license-manifest.json", "scope-manifest.json"]) {
    try {
      await readFile(path.join(directory, optionalName), "utf8")
      artifactNames.push(optionalName)
    } catch {
      // Corpus-locked observations intentionally omit FINAL-only evidence.
    }
  }
  const artifacts = []
  for (const name of artifactNames) {
    const text = await readFile(path.join(directory, name), "utf8")
    artifacts.push({ path: name, sha256: sha256(Buffer.from(text, "utf8")) })
  }
  const runtimeIdentityText = await readFile(path.join(directory, "runtime-identity.json"), "utf8")
  await writeFile(path.join(directory, "observation-provenance.json"), json({
    schemaVersion: 1,
    upstreamSha: NEW_SHA,
    gitHead: NEW_SHA,
    captureToolVersion: "fixture",
    capturedAt: "2026-01-01T00:00:00.000Z",
    runtimeExecutable: "fixture",
    runtimeArgs: [],
    runtimeIdentitySha256: sha256(Buffer.from(runtimeIdentityText, "utf8")),
    artifacts,
  }))
}

test("prepareCorpus refuses to fabricate an observation when no captured directory is supplied", async (t) => {
  const root = await createCorpusRepository()
  t.after(() => rm(root, { recursive: true, force: true }))

  await assert.rejects(
    prepareCorpus({ repositoryRoot: root, upstreamSha: NEW_SHA }),
    /legitimate observed corpus directory is required/,
  )
})

test("prepareCorpus installs exact bytes from a captured corpus and preserves its SHA", async (t) => {
  const root = await createCorpusRepository()
  const observedDirectory = await createObservedCorpus(root)
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = await prepareCorpus({ repositoryRoot: root, upstreamSha: NEW_SHA, observedCorpusDirectory: observedDirectory })

  assert.equal(result.previousUpstreamSha, OLD_SHA)
  assert.equal(result.upstreamSha, NEW_SHA)
  const destination = path.join(root, "managed", "tests", "upstream", NEW_SHA)
  const observedReceiptText = await readFile(path.join(observedDirectory, "observed-receipt.json"), "utf8")
  assert.equal(await readFile(path.join(destination, "observed-receipt.json"), "utf8"), observedReceiptText)
  const lock = JSON.parse(await readFile(path.join(root, "managed", "upstream.lock.json"), "utf8"))
  assert.equal(lock.upstreamSha, NEW_SHA)
  assert.equal(lock.protocolCorpusSha256, sha256(await readFile(path.join(destination, "manifest.json"), "utf8")))
  assert.equal(lock.sessionIdVerdictSha256, sha256(await readFile(path.join(destination, "session-id-verdict.json"), "utf8")))
  assert.match(
    await readFile(path.join(root, "managed", "shared", "src", "upstream-observed-receipt.ts"), "utf8"),
    new RegExp(`\\["${NEW_SHA}",\\s*"${sha256(observedReceiptText)}"\\]`),
  )
})

test("prepareCorpus rejects an existing destination with different bytes", async (t) => {
  const root = await createCorpusRepository()
  const observedDirectory = await createObservedCorpus(root)
  t.after(() => rm(root, { recursive: true, force: true }))

  const destination = path.join(root, "managed", "tests", "upstream", NEW_SHA)
  await cp(observedDirectory, destination, { recursive: true })
  await writeFile(path.join(destination, "rest.ndjson"), "tampered\n")
  await assert.rejects(
    prepareCorpus({ repositoryRoot: root, upstreamSha: NEW_SHA, observedCorpusDirectory: observedDirectory }),
    /destination corpus already exists with different bytes/,
  )
})

test("prepareCorpus refreshes every FINAL lock digest from captured artifact bytes", async (t) => {
  const root = await createCorpusRepository()
  const observedDirectory = await createObservedCorpus(root)
  const lockPath = path.join(root, "managed", "upstream.lock.json")
  const lock = JSON.parse(await readFile(lockPath, "utf8"))
  await writeFile(lockPath, json({
    ...lock,
    lockStage: "FINAL",
    browserRuntimeContractSha256: "1".repeat(64),
    licenseManifestSha256: "2".repeat(64),
    scopeManifestSha256: "3".repeat(64),
  }))
  await writeFile(path.join(observedDirectory, "license-manifest.json"), json({
    schemaVersion: 1,
    upstreamSha: NEW_SHA,
    manifestKind: "LICENSE",
    spdxLicense: "Apache-2.0",
    artifacts: [{ path: "LICENSE", sha256: sha256(Buffer.from("Apache License\n")), bytes: Buffer.byteLength("Apache License\n") }],
  }))
  await writeFile(path.join(observedDirectory, "scope-manifest.json"), json({
    schemaVersion: 1,
    upstreamSha: NEW_SHA,
    manifestKind: "SCOPE",
    allowedPaths: ["managed/tests/upstream"],
    artifacts: [{ path: "managed/upstream.lock.json", sha256: sha256(Buffer.from("scope\n")), bytes: Buffer.byteLength("scope\n") }],
  }))
  await writeObservedProvenance(observedDirectory)
  t.after(() => rm(root, { recursive: true, force: true }))

  await prepareCorpus({ repositoryRoot: root, upstreamSha: NEW_SHA, observedCorpusDirectory: observedDirectory })

  const refreshed = JSON.parse(await readFile(lockPath, "utf8"))
  assert.equal(refreshed.browserRuntimeContractSha256, sha256(await readFile(path.join(observedDirectory, "runtime-identity.json"))))
  assert.equal(refreshed.licenseManifestSha256, sha256(await readFile(path.join(observedDirectory, "license-manifest.json"))))
  assert.equal(refreshed.scopeManifestSha256, sha256(await readFile(path.join(observedDirectory, "scope-manifest.json"))))
})

test("prepareCorpus rejects observation bytes that drift from captured provenance", async (t) => {
  const root = await createCorpusRepository()
  const observedDirectory = await createObservedCorpus(root)
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(observedDirectory, "runtime-identity.json"), json({
    schemaVersion: 1,
    upstreamSha: NEW_SHA,
    runtimeVersion: "tampered",
    browserVersion: "fixture-browser",
    workerImageDigest: `sha256:${"1".repeat(64)}`,
  }))
  await assert.rejects(
    prepareCorpus({ repositoryRoot: root, upstreamSha: NEW_SHA, observedCorpusDirectory: observedDirectory }),
    /observation provenance artifact hash drift|runtime identity hash drift/,
  )
})

test("prepareCorpus rejects unknown and nested observation artifacts before copying", async (t) => {
  const root = await createCorpusRepository()
  const observedDirectory = await createObservedCorpus(root)
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(observedDirectory, "unexpected.json"), "not part of the capture contract\n")
  await assert.rejects(
    prepareCorpus({ repositoryRoot: root, upstreamSha: NEW_SHA, observedCorpusDirectory: observedDirectory }),
    /unauthorized artifacts|non-regular artifact/,
  )
})
