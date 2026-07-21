import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, test } from "node:test"

import { runCoolifyBundleCli } from "../coolify-bundle-cli.mjs"

const directory = await mkdtemp(path.join(tmpdir(), "steel-coolify-bundle-"))
after(async () => rm(directory, { force: true, recursive: true }))

const digest = (character) => `sha256:${character.repeat(64)}`
const sha = (character) => character.repeat(64)
const managerReceipt = path.join(directory, "manager.json")
const workerReceipt = path.join(directory, "worker.json")
const upstreamLock = path.join(directory, "upstream.json")
const toolchainLock = path.join(directory, "package-lock.json")
const output = path.join(directory, "output")

test("writes a secret-free digest-pinned Coolify release bundle", async () => {
  await writeFile(managerReceipt, JSON.stringify({
    candidateConfigDigest: digest("3"),
    candidateImage: `ghcr.io/example/manager@${digest("1")}`,
    candidateIndexDigest: digest("1"),
    candidatePlatformDigest: digest("2"),
    productionAuditReceiptSha256: sha("4"),
    sourceDateEpoch: "1784567890",
    sourceRevision: "a".repeat(40),
  }))
  await writeFile(workerReceipt, JSON.stringify({
    candidateConfigDigest: digest("8"),
    candidateImage: `ghcr.io/example/worker@${digest("6")}`,
    candidateIndexDigest: digest("6"),
    candidatePlatformDigest: digest("7"),
    productionAuditReceiptSha256: sha("9"),
    sourceDateEpoch: "1784567890",
    sourceRevision: "a".repeat(40),
  }))
  await writeFile(upstreamLock, JSON.stringify({ upstreamSha: "b".repeat(40) }))
  await writeFile(toolchainLock, "toolchain-lock-bytes")

  await runCoolifyBundleCli([
    "--browser-version", "150.0.7871.46",
    "--manager-receipt", managerReceipt,
    "--output", output,
    "--toolchain-lock", toolchainLock,
    "--upstream-lock", upstreamLock,
    "--worker-receipt", workerReceipt,
  ])

  const manifest = JSON.parse(await readFile(path.join(output, "release-manifest.json"), "utf8"))
  const blue = JSON.parse(await readFile(path.join(output, "blue", "compose.yml"), "utf8"))
  const evidence = await readFile(path.join(output, "release-evidence.json"), "utf8")
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.managerImage, `ghcr.io/example/manager@${digest("1")}`)
  assert.equal(blue.services.manager.image, manifest.managerImage)
  assert.equal(evidence.includes("STEEL_MANAGED_CREATE_TOKEN_KEY_HEX"), false)
  assert.match(manifest.releaseEvidenceSha256, /^[0-9a-f]{64}$/u)
})
