import assert from "node:assert/strict"
import { test } from "node:test"

import {
  CoolifyPoolSlot,
  buildCoolifyCompose,
  verifyCoolifyCompose,
} from "../coolify-bundle.mjs"

const managerImage = `ghcr.io/happycastle114/steel-managed-manager@sha256:${"1".repeat(64)}`
const workerImage = `ghcr.io/happycastle114/steel-managed-worker@sha256:${"2".repeat(64)}`
const releaseEvidenceSha256 = "3".repeat(64)

test("generates isolated blue and green Coolify projects", () => {
  const blue = buildCoolifyCompose({
    managerImage,
    poolSlot: CoolifyPoolSlot.BLUE,
    releaseEvidenceSha256,
    workerImage,
  })
  const green = buildCoolifyCompose({
    managerImage,
    poolSlot: CoolifyPoolSlot.GREEN,
    releaseEvidenceSha256,
    workerImage,
  })

  assert.equal(verifyCoolifyCompose(blue).poolId, "managed-blue-pool")
  assert.equal(verifyCoolifyCompose(green).poolId, "managed-green-pool")
  assert.deepEqual(Object.keys(blue.services), ["manager", "worker-00", "worker-01"])
  assert.deepEqual(blue.services["worker-00"].networks, ["private"])
  assert.deepEqual(blue.services["worker-01"].networks, ["private"])
  assert.deepEqual(blue.services.manager.networks, ["coolify", "private"])
  assert.equal("ports" in blue.services.manager, false)
  assert.equal("ports" in blue.services["worker-00"], false)
  assert.deepEqual(blue.services.manager.secrets.map(({ source }) => source), [
    "managed-create-token-key",
    "managed-release-evidence",
  ])
  assert.equal(blue.services.manager.read_only, false)
  assert.equal(blue.services["worker-00"].read_only, true)
  assert.equal(blue.services["worker-01"].read_only, true)
  assert.equal("secrets" in blue.services["worker-00"], false)
})

test("rejects mutable images, worker exposure, and manager secret drift", () => {
  const valid = buildCoolifyCompose({
    managerImage,
    poolSlot: CoolifyPoolSlot.BLUE,
    releaseEvidenceSha256,
    workerImage,
  })
  const mutations = [
    { ...valid, services: { ...valid.services, manager: { ...valid.services.manager, image: "manager:latest" } } },
    { ...valid, services: { ...valid.services, "worker-00": { ...valid.services["worker-00"], ports: ["3000:3000"] } } },
    { ...valid, services: { ...valid.services, "worker-01": { ...valid.services["worker-01"], networks: ["coolify", "private"] } } },
    { ...valid, services: { ...valid.services, manager: { ...valid.services.manager, secrets: [] } } },
    { ...valid, services: { ...valid.services, manager: { ...valid.services.manager, read_only: true } } },
  ]

  for (const mutation of mutations) {
    assert.throws(() => verifyCoolifyCompose(mutation))
  }
})
