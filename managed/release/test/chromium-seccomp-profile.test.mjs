import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

import {
  CHROMIUM_SECCOMP_PROFILE,
  verifyChromiumSeccompProfileBytes,
} from "../chromium-seccomp-profile.mjs"
import { CoolifyPoolSlot, buildCoolifyCompose } from "../coolify-bundle.mjs"

const managerImage = `ghcr.io/example/manager@sha256:${"1".repeat(64)}`
const workerImage = `ghcr.io/example/worker@sha256:${"2".repeat(64)}`

test("pins the official Playwright Chromium sandbox profile by digest", async () => {
  const bytes = await readFile(
    new URL("../../../deploy/coolify/chromium-seccomp.json", import.meta.url),
  )

  assert.deepEqual(verifyChromiumSeccompProfileBytes(bytes), {
    sha256: CHROMIUM_SECCOMP_PROFILE.sha256,
  })
  assert.match(CHROMIUM_SECCOMP_PROFILE.sourceUrl, new RegExp(CHROMIUM_SECCOMP_PROFILE.sourceRevision, "u"))
})

test("applies the sandbox profile only to private non-root workers", () => {
  const compose = buildCoolifyCompose({
    managerImage,
    poolSlot: CoolifyPoolSlot.BLUE,
    releaseEvidenceSha256: "3".repeat(64),
    workerImage,
  })
  const expected = [
    "no-new-privileges:true",
    `seccomp=${CHROMIUM_SECCOMP_PROFILE.bundleDeploymentPath}`,
  ]

  assert.deepEqual(compose.services["worker-00"].security_opt, expected)
  assert.deepEqual(compose.services["worker-01"].security_opt, expected)
  assert.deepEqual(compose.services.manager.security_opt, ["no-new-privileges:true"])
  assert.deepEqual(compose.services["worker-00"].cap_drop, ["ALL"])
  assert.equal(compose.services["worker-00"].user, "10001:10001")
  assert.equal(compose.services["worker-00"].read_only, true)
})
