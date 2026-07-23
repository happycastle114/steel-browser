import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

import {
  CoolifyComposeProfileLocation,
  CoolifyPoolSlot,
  CoolifyWorkerSecurityOption,
  verifyCoolifyCompose,
} from "../coolify-bundle.mjs"
import {
  buildCoolifySourceCompose,
  materializeCoolifySourceCompose,
} from "../coolify-source-compose.mjs"

const managerImage = `ghcr.io/example/manager@sha256:${"1".repeat(64)}`
const workerImage = `ghcr.io/example/worker@sha256:${"2".repeat(64)}`
const releaseEvidenceSha256 = "3".repeat(64)

test("source templates materialize into exact verified release Compose", async () => {
  for (const [slot, path] of [
    [CoolifyPoolSlot.BLUE, new URL("../../../deploy/coolify/compose.blue.yml", import.meta.url)],
    [CoolifyPoolSlot.GREEN, new URL("../../../deploy/coolify/compose.green.yml", import.meta.url)],
  ]) {
    const expected = buildCoolifySourceCompose(slot)
    const checkedIn = JSON.parse(await readFile(path, "utf8"))
    assert.deepEqual(checkedIn, expected)
    const materialized = materializeCoolifySourceCompose(checkedIn, {
      managerImage,
      releaseEvidenceSha256,
      workerImage,
    })
    assert.equal(
      verifyCoolifyCompose(materialized, CoolifyComposeProfileLocation.SOURCE).poolId,
      expected["x-steel-managed"].poolId,
    )
    for (const workerId of ["worker-00", "worker-01"]) {
      assert.deepEqual(checkedIn.services[workerId].security_opt, [
        CoolifyWorkerSecurityOption.APPARMOR_USER_NAMESPACE_COMPATIBILITY,
        CoolifyWorkerSecurityOption.NO_NEW_PRIVILEGES,
        "seccomp=./deploy/coolify/chromium-seccomp.json",
      ])
    }
  }
})

test("source templates fail closed without every digest-bound release value", () => {
  const source = buildCoolifySourceCompose(CoolifyPoolSlot.BLUE)

  assert.throws(() => materializeCoolifySourceCompose(source, {
    managerImage: "manager:latest",
    releaseEvidenceSha256,
    workerImage,
  }))
})
