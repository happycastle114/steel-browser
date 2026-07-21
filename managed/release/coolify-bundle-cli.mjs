#!/usr/bin/env node

import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

import {
  CoolifyPoolSlot,
  buildCoolifyCompose,
  serializeCoolifyCompose,
} from "./coolify-bundle.mjs"
import {
  buildReleaseEvidence,
  serializeReleaseEvidence,
} from "./release-evidence.mjs"

const CliFlag = Object.freeze({
  BROWSER_VERSION: "--browser-version",
  MANAGER_RECEIPT: "--manager-receipt",
  OUTPUT: "--output",
  TOOLCHAIN_LOCK: "--toolchain-lock",
  UPSTREAM_LOCK: "--upstream-lock",
  WORKER_RECEIPT: "--worker-receipt",
})

export async function runCoolifyBundleCli(arguments_) {
  const options = parseArguments(arguments_)
  const [managerBytes, workerBytes, upstreamBytes, toolchainBytes] = await Promise.all([
    readFile(options.managerReceipt),
    readFile(options.workerReceipt),
    readFile(options.upstreamLock),
    readFile(options.toolchainLock),
  ])
  const managerReceipt = parseJson(managerBytes, "manager receipt")
  const workerReceipt = parseJson(workerBytes, "worker receipt")
  const upstreamLock = parseJson(upstreamBytes, "upstream lock")
  if (!isRecord(upstreamLock) || typeof upstreamLock.upstreamSha !== "string") {
    throw new TypeError("upstream lock revision missing")
  }
  const evidence = buildReleaseEvidence({
    browserVersion: options.browserVersion,
    managerReceipt,
    toolchainLockSha256: sha256(toolchainBytes),
    upstreamRevision: upstreamLock.upstreamSha,
    workerReceipt,
    workerRuntimeStrategyReceiptSha256: sha256(workerBytes),
  })
  const serializedEvidence = serializeReleaseEvidence(evidence)
  const releaseEvidenceSha256 = sha256(Buffer.from(serializedEvidence, "utf8"))
  const composeInput = {
    managerImage: evidence.body.managerImage.ref,
    releaseEvidenceSha256,
    workerImage: evidence.body.workerImage.ref,
  }
  const blue = buildCoolifyCompose({ ...composeInput, poolSlot: CoolifyPoolSlot.BLUE })
  const green = buildCoolifyCompose({ ...composeInput, poolSlot: CoolifyPoolSlot.GREEN })
  const manifest = {
    schemaVersion: 1,
    managedRevision: evidence.body.source.managedRevision,
    managerImage: evidence.body.managerImage.ref,
    releaseEvidenceSha256,
    upstreamRevision: evidence.body.source.upstreamRevision,
    workerImage: evidence.body.workerImage.ref,
  }
  const blueDirectory = path.join(options.output, "blue")
  const greenDirectory = path.join(options.output, "green")
  await Promise.all([
    mkdir(blueDirectory, { recursive: true }),
    mkdir(greenDirectory, { recursive: true }),
  ])
  await Promise.all([
    writeFile(path.join(options.output, "release-evidence.json"), serializedEvidence, { mode: 0o400 }),
    writeFile(path.join(options.output, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(path.join(blueDirectory, "compose.yml"), serializeCoolifyCompose(blue)),
    writeFile(path.join(greenDirectory, "compose.yml"), serializeCoolifyCompose(green)),
  ])
}

function parseArguments(arguments_) {
  if (arguments_.length !== Object.keys(CliFlag).length * 2) {
    throw new TypeError("every Coolify bundle flag is required exactly once")
  }
  const values = new Map()
  const known = new Set(Object.values(CliFlag))
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index]
    const value = arguments_[index + 1]
    if (!known.has(flag) || values.has(flag) || typeof value !== "string" || value.length === 0) {
      throw new TypeError("invalid Coolify bundle argument")
    }
    values.set(flag, value)
  }
  return Object.freeze({
    browserVersion: values.get(CliFlag.BROWSER_VERSION),
    managerReceipt: values.get(CliFlag.MANAGER_RECEIPT),
    output: values.get(CliFlag.OUTPUT),
    toolchainLock: values.get(CliFlag.TOOLCHAIN_LOCK),
    upstreamLock: values.get(CliFlag.UPSTREAM_LOCK),
    workerReceipt: values.get(CliFlag.WORKER_RECEIPT),
  })
}

function parseJson(bytes, field) {
  try {
    return JSON.parse(bytes.toString("utf8"))
  } catch {
    throw new TypeError(`${field} is not valid JSON`)
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const invocation = process.argv[1]
if (invocation !== undefined && import.meta.url === pathToFileURL(invocation).href) {
  runCoolifyBundleCli(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : "unknown Coolify bundle error"
    process.stderr.write(`Coolify bundle generation failed: ${message}\n`)
    process.exitCode = 1
  })
}
