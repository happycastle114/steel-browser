import assert from "node:assert/strict"
import { test } from "node:test"

import {
  CoolifyDeploymentStatus,
  classifyCoolifyDeploymentStatus,
  waitForCoolifyDeployment,
} from "../coolify-deployment-poller.mjs"

test("normalizes only the documented Coolify deployment states", () => {
  assert.equal(classifyCoolifyDeploymentStatus("queued"), CoolifyDeploymentStatus.QUEUED)
  assert.equal(classifyCoolifyDeploymentStatus("in_progress"), CoolifyDeploymentStatus.IN_PROGRESS)
  assert.equal(classifyCoolifyDeploymentStatus("finished"), CoolifyDeploymentStatus.FINISHED)
  assert.equal(classifyCoolifyDeploymentStatus("finished_with_warning"), CoolifyDeploymentStatus.UNKNOWN)
})

test("waits through a bounded queue and rejects terminal failure", async () => {
  const statuses = ["queued", "in_progress", "failed"]
  let reads = 0

  await assert.rejects(() => waitForCoolifyDeployment({
    deploymentUuid: "deployment-1",
    intervalMs: 1,
    maxAttempts: 3,
    read: async () => ({
      deployment_uuid: "deployment-1",
      status: statuses[reads++],
    }),
    sleep: async () => undefined,
  }))
  assert.equal(reads, 3)
})
