#!/usr/bin/env node

import { readFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { deployCoolifyRelease } from "./coolify-api-client.mjs"
import { CoolifyPoolSlot } from "./coolify-bundle.mjs"
import {
  CHROMIUM_SECCOMP_PROFILE,
  verifyChromiumSeccompProfileBytes,
} from "./chromium-seccomp-profile.mjs"

const DeployEnvironmentKey = Object.freeze({
  API_BASE: "COOLIFY_API_BASE",
  API_TOKEN: "COOLIFY_API_TOKEN",
  BLUE_UUID: "COOLIFY_BLUE_APPLICATION_UUID",
  CONFIG_JSON: "STEEL_MANAGED_CONFIG_JSON",
  CREATE_TOKEN_KEY_HEX: "STEEL_MANAGED_CREATE_TOKEN_KEY_HEX",
  GREEN_UUID: "COOLIFY_GREEN_APPLICATION_UUID",
  RELEASE_DIRECTORY: "STEEL_MANAGED_RELEASE_DIRECTORY",
  ROUTE_HOST: "STEEL_MANAGED_ROUTE_HOST",
})

export async function runCoolifyDeployCli(arguments_, environment, fetcher = fetch) {
  const targetSlot = parseArguments(arguments_)
  const values = readEnvironment(environment)
  const bundleSlot = targetSlot.toLowerCase()
  const [manifestBytes, releaseEvidence, seccompProfileBytes] = await Promise.all([
    readFile(path.join(values.releaseDirectory, "release-manifest.json"), "utf8"),
    readFile(path.join(values.releaseDirectory, "release-evidence.json"), "utf8"),
    readFile(path.join(
      values.releaseDirectory,
      bundleSlot,
      CHROMIUM_SECCOMP_PROFILE.bundleDeploymentPath,
    )),
  ])
  const manifest = parseManifest(manifestBytes)
  const seccompProfile = verifyChromiumSeccompProfileBytes(seccompProfileBytes)
  if (manifest.chromiumSeccompProfileSha256 !== seccompProfile.sha256) {
    throw new TypeError("release manifest Chromium seccomp profile digest mismatch")
  }
  const isBlue = targetSlot === CoolifyPoolSlot.BLUE
  const receipt = await deployCoolifyRelease({
    apiBase: values.apiBase,
    apiToken: values.apiToken,
    configJson: values.configJson,
    createTokenKeyHex: values.createTokenKeyHex,
    fetcher,
    otherApplicationUuid: isBlue ? values.greenUuid : values.blueUuid,
    release: {
      managedRevision: manifest.managedRevision,
      managerImage: manifest.managerImage,
      releaseEvidence,
      releaseEvidenceSha256: manifest.releaseEvidenceSha256,
      workerImage: manifest.workerImage,
    },
    routeHost: values.routeHost,
    targetApplicationUuid: isBlue ? values.blueUuid : values.greenUuid,
    targetSlot,
  })
  process.stdout.write(`${JSON.stringify(receipt)}\n`)
}

function parseArguments(arguments_) {
  if (arguments_.length !== 2 || arguments_[0] !== "--target-slot") {
    throw new TypeError("--target-slot BLUE|GREEN is required")
  }
  const slot = arguments_[1]
  if (slot !== CoolifyPoolSlot.BLUE && slot !== CoolifyPoolSlot.GREEN) {
    throw new TypeError("Coolify target slot must be BLUE or GREEN")
  }
  return slot
}

function readEnvironment(environment) {
  const read = (key) => {
    const value = environment[key]
    if (typeof value !== "string" || value.length === 0) {
      throw new TypeError(`${key} is required`)
    }
    return value
  }
  return Object.freeze({
    apiBase: read(DeployEnvironmentKey.API_BASE),
    apiToken: read(DeployEnvironmentKey.API_TOKEN),
    blueUuid: read(DeployEnvironmentKey.BLUE_UUID),
    configJson: read(DeployEnvironmentKey.CONFIG_JSON),
    createTokenKeyHex: read(DeployEnvironmentKey.CREATE_TOKEN_KEY_HEX),
    greenUuid: read(DeployEnvironmentKey.GREEN_UUID),
    releaseDirectory: read(DeployEnvironmentKey.RELEASE_DIRECTORY),
    routeHost: read(DeployEnvironmentKey.ROUTE_HOST),
  })
}

function parseManifest(bytes) {
  try {
    const manifest = JSON.parse(bytes)
    if (typeof manifest !== "object" || manifest === null || manifest.schemaVersion !== 1) {
      throw new TypeError("release manifest schema invalid")
    }
    return manifest
  } catch (error) {
    if (error instanceof TypeError) throw error
    throw new TypeError("release manifest is not JSON")
  }
}

const invocation = process.argv[1]
if (invocation !== undefined && import.meta.url === pathToFileURL(invocation).href) {
  runCoolifyDeployCli(process.argv.slice(2), process.env).catch((error) => {
    const message = error instanceof Error ? error.message : "unknown Coolify deployment error"
    process.stderr.write(`Coolify deployment failed: ${message}\n`)
    process.exitCode = 1
  })
}
