import { createHash } from "node:crypto"

import { CoolifyPoolSlot } from "./coolify-bundle.mjs"
import {
  CoolifyDeploymentStatus,
  waitForCoolifyDeployment,
} from "./coolify-deployment-poller.mjs"

export const CoolifyApplicationRuntimeState = Object.freeze({
  RUNNING: "RUNNING",
  STOPPED: "STOPPED",
  UNKNOWN: "UNKNOWN",
})

const CoolifyBuildPack = Object.freeze({ DOCKER_COMPOSE: "dockercompose" })
const requestTimeoutMs = 30_000
const responseBytesMax = 1_048_576
const digestImagePattern = /^[a-z0-9][a-z0-9._/-]*@sha256:[0-9a-f]{64}$/u
const sha256Pattern = /^[0-9a-f]{64}$/u
const gitRevisionPattern = /^[0-9a-f]{40}$/u
const uuidPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u
const hostnamePattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u

export class CoolifyReleaseError extends Error {
  constructor(message) {
    super(message)
    this.name = "CoolifyReleaseError"
  }
}

export async function deployCoolifyRelease(input) {
  const options = parseOptions(input)
  const client = new CoolifyApiClient(options)
  const [target, other] = await Promise.all([
    client.getApplication(options.targetApplicationUuid),
    client.getApplication(options.otherApplicationUuid),
  ])
  verifyTargetApplication(target, options)
  if (!isRecord(other) || other.uuid !== options.otherApplicationUuid) {
    throw new CoolifyReleaseError("Coolify standby application identity drift")
  }
  const targetInitialState = classifyApplicationState(target.status)
  const otherState = classifyApplicationState(other.status)
  if (
    targetInitialState !== CoolifyApplicationRuntimeState.STOPPED ||
    otherState !== CoolifyApplicationRuntimeState.STOPPED
  ) {
    throw new CoolifyReleaseError("serialized Coolify deployment requires both projects stopped")
  }
  await client.updateApplication(options.targetApplicationUuid, {
    git_commit_sha: options.release.managedRevision,
    is_container_label_escape_enabled: false,
  })
  await client.updateEnvironment(
    options.targetApplicationUuid,
    buildEnvironment(options),
  )
  const configuredStates = (await Promise.all([
    client.getApplication(options.targetApplicationUuid), client.getApplication(options.otherApplicationUuid),
  ])).map((application) => classifyApplicationState(isRecord(application) ? application.status : undefined))
  if (configuredStates.some((state) => state !== CoolifyApplicationRuntimeState.STOPPED))
    throw new CoolifyReleaseError("serialized Coolify deployment requires both projects stopped")
  const deployment = await client.startApplication(options.targetApplicationUuid)
  if (!isRecord(deployment) || typeof deployment.deployment_uuid !== "string") {
    throw new CoolifyReleaseError("Coolify deployment receipt missing")
  }
  const deploymentStatus = await waitForCoolifyDeployment({
    deploymentUuid: deployment.deployment_uuid,
    read: (uuid) => client.getDeployment(uuid),
    sleep: options.sleep,
  })
  if (deploymentStatus !== CoolifyDeploymentStatus.FINISHED) {
    throw new CoolifyReleaseError("Coolify deployment did not finish")
  }
  const started = await client.getApplication(options.targetApplicationUuid)
  const targetState = classifyApplicationState(started.status)
  if (targetState !== CoolifyApplicationRuntimeState.RUNNING) {
    throw new CoolifyReleaseError("Coolify application did not enter running state")
  }
  return Object.freeze({
    deploymentUuid: deployment.deployment_uuid,
    deploymentStatus,
    otherState,
    targetApplicationUuid: options.targetApplicationUuid,
    targetState,
  })
}

class CoolifyApiClient {
  constructor(options) {
    this.apiBase = options.apiBase
    this.apiToken = options.apiToken
    this.fetcher = options.fetcher
  }

  getApplication(uuid) {
    return this.request(`/applications/${uuid}`)
  }

  getDeployment(uuid) {
    return this.request(`/deployments/${uuid}`)
  }

  updateApplication(uuid, body) {
    return this.request(`/applications/${uuid}`, { body, method: "PATCH" })
  }

  updateEnvironment(uuid, data) {
    return this.request(`/applications/${uuid}/envs/bulk`, {
      body: { data },
      method: "PATCH",
    })
  }

  startApplication(uuid) {
    return this.request(`/applications/${uuid}/start?force=true`, { method: "POST" })
  }

  async request(path, options = {}) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
    try {
      const headers = {
        Accept: "application/json",
        Authorization: `Bearer ${this.apiToken}`,
      }
      let body
      if (options.body !== undefined) {
        headers["Content-Type"] = "application/json"
        body = JSON.stringify(options.body)
      }
      const response = await this.fetcher(`${this.apiBase}${path}`, {
        body,
        headers,
        method: options.method ?? "GET",
        signal: controller.signal,
      })
      if (!response.ok) throw new CoolifyReleaseError(`Coolify API rejected request with ${response.status}`)
      const text = await response.text()
      if (Buffer.byteLength(text, "utf8") > responseBytesMax) {
        throw new CoolifyReleaseError("Coolify API response exceeds bound")
      }
      try {
        return JSON.parse(text)
      } catch {
        throw new CoolifyReleaseError("Coolify API response is not JSON")
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}

function buildEnvironment(options) {
  const values = {
    STEEL_MANAGED_CONFIG_JSON: canonicalJson(options.configJson, "manager config"),
    STEEL_MANAGED_CREATE_TOKEN_KEY_HEX: options.createTokenKeyHex,
    STEEL_MANAGED_MANAGER_IMAGE: options.release.managerImage,
    STEEL_MANAGED_RELEASE_EVIDENCE_JSON: options.release.releaseEvidence,
    STEEL_MANAGED_RELEASE_EVIDENCE_SHA256: options.release.releaseEvidenceSha256,
    STEEL_MANAGED_ROUTE_HOST: options.routeHost,
    STEEL_MANAGED_WORKER_IMAGE: options.release.workerImage,
  }
  return Object.entries(values).map(([key, value]) => ({
    is_buildtime: true,
    is_literal: true,
    is_multiline: false,
    is_preview: false,
    is_runtime: false,
    is_shown_once:
      key === "STEEL_MANAGED_CREATE_TOKEN_KEY_HEX" ||
      key === "STEEL_MANAGED_RELEASE_EVIDENCE_JSON",
    key,
    value,
  }))
}

function parseOptions(input) {
  const api = new URL(input.apiBase)
  if (api.protocol !== "https:" || !api.pathname.endsWith("/api/v1")) {
    throw new CoolifyReleaseError("Coolify API base must be HTTPS /api/v1")
  }
  for (const uuid of [input.targetApplicationUuid, input.otherApplicationUuid]) {
    if (typeof uuid !== "string" || !uuidPattern.test(uuid)) {
      throw new CoolifyReleaseError("Coolify application UUID invalid")
    }
  }
  if (input.targetApplicationUuid === input.otherApplicationUuid) {
    throw new CoolifyReleaseError("Coolify projects must be distinct")
  }
  if (input.targetSlot !== CoolifyPoolSlot.BLUE && input.targetSlot !== CoolifyPoolSlot.GREEN) {
    throw new CoolifyReleaseError("Coolify target slot invalid")
  }
  if (typeof input.apiToken !== "string" || input.apiToken.length < 1) {
    throw new CoolifyReleaseError("Coolify API token missing")
  }
  if (typeof input.routeHost !== "string" || !hostnamePattern.test(input.routeHost)) {
    throw new CoolifyReleaseError("Coolify route Host invalid")
  }
  verifyRelease(input.release)
  if (!/^[0-9a-f]{64}$/u.test(input.createTokenKeyHex)) {
    throw new CoolifyReleaseError("managed create token key invalid")
  }
  canonicalJson(input.configJson, "manager config")
  return Object.freeze({ ...input, apiBase: api.href.replace(/\/$/u, "") })
}

function verifyRelease(release) {
  if (!isRecord(release)) throw new CoolifyReleaseError("release input missing")
  if (!gitRevisionPattern.test(release.managedRevision)) throw new CoolifyReleaseError("release revision invalid")
  if (!digestImagePattern.test(release.managerImage) || !digestImagePattern.test(release.workerImage)) {
    throw new CoolifyReleaseError("release images must be digest-pinned")
  }
  if (!sha256Pattern.test(release.releaseEvidenceSha256)) {
    throw new CoolifyReleaseError("release evidence digest invalid")
  }
  if (typeof release.releaseEvidence !== "string") throw new CoolifyReleaseError("release evidence missing")
  const actual = createHash("sha256").update(release.releaseEvidence).digest("hex")
  if (actual !== release.releaseEvidenceSha256) throw new CoolifyReleaseError("release evidence digest mismatch")
  canonicalJson(release.releaseEvidence, "release evidence")
}

function verifyTargetApplication(application, options) {
  const expectedLocation = `/deploy/coolify/compose.${options.targetSlot.toLowerCase()}.yml`
  if (
    !isRecord(application) ||
    application.uuid !== options.targetApplicationUuid ||
    application.build_pack !== CoolifyBuildPack.DOCKER_COMPOSE ||
    application.docker_compose_location !== expectedLocation
  ) throw new CoolifyReleaseError("Coolify target application contract drift")
}

function classifyApplicationState(status) {
  if (typeof status !== "string") return CoolifyApplicationRuntimeState.UNKNOWN
  if (status === "stopped" || status.startsWith("exited")) return CoolifyApplicationRuntimeState.STOPPED
  if (status.startsWith("running")) return CoolifyApplicationRuntimeState.RUNNING
  return CoolifyApplicationRuntimeState.UNKNOWN
}

function canonicalJson(value, field) {
  try {
    return JSON.stringify(JSON.parse(value))
  } catch {
    throw new CoolifyReleaseError(`${field} must be JSON`)
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
