import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { test } from "node:test"

import {
  CoolifyApplicationRuntimeState,
  deployCoolifyRelease,
} from "../coolify-api-client.mjs"
import { CoolifyDeploymentStatus } from "../coolify-deployment-poller.mjs"

const releaseEvidence = JSON.stringify({ schemaVersion: 1 })
const release = Object.freeze({
  managedRevision: "a".repeat(40),
  managerImage: `ghcr.io/example/manager@sha256:${"1".repeat(64)}`,
  releaseEvidence,
  releaseEvidenceSha256: createHash("sha256").update(releaseEvidence).digest("hex"),
  workerImage: `ghcr.io/example/worker@sha256:${"3".repeat(64)}`,
})

test("updates only a stopped standby and queues one serialized Coolify deployment", async () => {
  const calls = []
  let blueReads = 0
  const fetcher = async (url, init = {}) => {
    calls.push({ url, init })
    if (url.endsWith("/applications/blue")) {
      blueReads += 1
      return response(200, {
        uuid: "blue",
        build_pack: "dockercompose",
        docker_compose_location: "/deploy/coolify/compose.blue.yml",
        status: blueReads < 4 ? "stopped" : "running:healthy",
      })
    }
    if (url.endsWith("/applications/green")) {
      return response(200, { uuid: "green", status: "stopped" })
    }
    if (url.endsWith("/applications/blue/envs/bulk")) return response(201, [])
    if (url.endsWith("/applications/blue/start?force=true")) {
      return response(200, { deployment_uuid: "deployment-1", message: "queued" })
    }
    if (url.endsWith("/deployments/deployment-1")) {
      return response(200, { deployment_uuid: "deployment-1", status: "finished" })
    }
    return response(200, { uuid: "blue" })
  }

  const result = await deployCoolifyRelease({
    apiBase: "https://coolify.example/api/v1",
    apiToken: "api-token-not-logged",
    configJson: JSON.stringify({ schemaVersion: 1 }),
    createTokenKeyHex: "4".repeat(64),
    fetcher,
    otherApplicationUuid: "green",
    release,
    routeHost: "steel-candidate.example.com",
    sleep: async () => undefined,
    targetApplicationUuid: "blue",
    targetSlot: "BLUE",
  })

  assert.deepEqual(result, {
    deploymentUuid: "deployment-1",
    deploymentStatus: CoolifyDeploymentStatus.FINISHED,
    otherState: CoolifyApplicationRuntimeState.STOPPED,
    targetApplicationUuid: "blue",
    targetState: CoolifyApplicationRuntimeState.RUNNING,
  })
  assert.equal(calls.length, 9)
  const environmentCall = calls.find(({ url }) => url.endsWith("/envs/bulk"))
  const environment = JSON.parse(environmentCall.init.body).data
  assert.deepEqual(environment.map(({ key }) => key), [
    "STEEL_MANAGED_CONFIG_JSON",
    "STEEL_MANAGED_CREATE_TOKEN_KEY_HEX",
    "STEEL_MANAGED_MANAGER_IMAGE",
    "STEEL_MANAGED_RELEASE_EVIDENCE_JSON",
    "STEEL_MANAGED_RELEASE_EVIDENCE_SHA256",
    "STEEL_MANAGED_ROUTE_HOST",
    "STEEL_MANAGED_WORKER_IMAGE",
  ])
  assert.equal(environment.every(({ is_buildtime, is_runtime }) => is_buildtime && is_runtime), true)
  assert.equal(calls.every(({ init }) => init.headers.Authorization === "Bearer api-token-not-logged"), true)
})

test("rechecks both projects after configuration and refuses a racing start", async () => {
  const calls = []
  let greenReads = 0
  const fetcher = async (url, init = {}) => {
    calls.push({ url, init })
    if (url.endsWith("/applications/blue")) {
      return response(200, {
        uuid: "blue",
        build_pack: "dockercompose",
        docker_compose_location: "/deploy/coolify/compose.blue.yml",
        status: "stopped",
      })
    }
    if (url.endsWith("/applications/green")) {
      greenReads += 1
      return response(200, {
        uuid: "green",
        status: greenReads === 1 ? "stopped" : "running:healthy",
      })
    }
    if (url.endsWith("/applications/blue/envs/bulk")) return response(201, [])
    return response(200, { uuid: "blue" })
  }

  await assert.rejects(() => deployCoolifyRelease({
    apiBase: "https://coolify.example/api/v1",
    apiToken: "token",
    configJson: "{}",
    createTokenKeyHex: "4".repeat(64),
    fetcher,
    otherApplicationUuid: "green",
    release,
    routeHost: "steel.example.com",
    targetApplicationUuid: "blue",
    targetSlot: "BLUE",
  }), /both projects stopped/u)
  assert.equal(calls.some(({ url }) => url.includes("/start?")), false)
})

test("refuses to mutate Coolify while the other project is running", async () => {
  const calls = []
  const fetcher = async (url, init = {}) => {
    calls.push({ url, init })
    return url.endsWith("/applications/green")
      ? response(200, { uuid: "green", status: "running:healthy" })
      : response(200, {
          uuid: "blue",
          build_pack: "dockercompose",
          docker_compose_location: "/deploy/coolify/compose.blue.yml",
          status: "stopped",
        })
  }

  await assert.rejects(() => deployCoolifyRelease({
    apiBase: "https://coolify.example/api/v1",
    apiToken: "token",
    configJson: "{}",
    createTokenKeyHex: "4".repeat(64),
    fetcher,
    otherApplicationUuid: "green",
    release,
    routeHost: "steel.example.com",
    targetApplicationUuid: "blue",
    targetSlot: "BLUE",
  }))
  assert.equal(calls.length, 2)
})

function response(status, body) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  })
}
