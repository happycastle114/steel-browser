import { isDeepStrictEqual } from "node:util"

import {
  CoolifyPoolSlot,
  buildCoolifyCompose,
  verifyCoolifyCompose,
} from "./coolify-bundle.mjs"

export const CoolifySourceVariable = Object.freeze({
  MANAGER_IMAGE: "${STEEL_MANAGED_MANAGER_IMAGE:?digest-pinned manager image is required}",
  RELEASE_EVIDENCE_SHA256: "${STEEL_MANAGED_RELEASE_EVIDENCE_SHA256:?release evidence SHA-256 is required}",
  WORKER_IMAGE: "${STEEL_MANAGED_WORKER_IMAGE:?digest-pinned worker image is required}",
})

const fixture = Object.freeze({
  managerImage: `ghcr.io/example/manager@sha256:${"1".repeat(64)}`,
  releaseEvidenceSha256: "3".repeat(64),
  workerImage: `ghcr.io/example/worker@sha256:${"2".repeat(64)}`,
})

export function buildCoolifySourceCompose(poolSlot) {
  const compose = structuredClone(buildCoolifyCompose({ ...fixture, poolSlot }))
  compose.services.manager.image = CoolifySourceVariable.MANAGER_IMAGE
  compose.services["worker-00"].image = CoolifySourceVariable.WORKER_IMAGE
  compose.services["worker-01"].image = CoolifySourceVariable.WORKER_IMAGE
  compose.services.manager.command = replaceReleaseEvidenceArgument(
    compose.services.manager.command,
    CoolifySourceVariable.RELEASE_EVIDENCE_SHA256,
  )
  return compose
}

export function materializeCoolifySourceCompose(source, release) {
  const metadata = source["x-steel-managed"]
  if (metadata === undefined) throw new TypeError("Coolify source metadata missing")
  const poolSlot = metadata.poolSlot
  if (poolSlot !== CoolifyPoolSlot.BLUE && poolSlot !== CoolifyPoolSlot.GREEN) {
    throw new TypeError("Coolify source pool slot invalid")
  }
  if (!isDeepStrictEqual(source, buildCoolifySourceCompose(poolSlot))) {
    throw new TypeError("Coolify source template drift")
  }
  const compose = structuredClone(source)
  compose.services.manager.image = release.managerImage
  compose.services["worker-00"].image = release.workerImage
  compose.services["worker-01"].image = release.workerImage
  compose.services.manager.command = replaceReleaseEvidenceArgument(
    compose.services.manager.command,
    release.releaseEvidenceSha256,
  )
  verifyCoolifyCompose(compose)
  return compose
}

function replaceReleaseEvidenceArgument(command, digest) {
  const prefix = "--release-evidence-sha256="
  return command.map((argument) =>
    typeof argument === "string" && argument.startsWith(prefix)
      ? `${prefix}${digest}`
      : argument,
  )
}
