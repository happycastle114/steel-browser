export const CoolifyDeploymentStatus = Object.freeze({
  CANCELLED: "CANCELLED",
  FAILED: "FAILED",
  FINISHED: "FINISHED",
  IN_PROGRESS: "IN_PROGRESS",
  QUEUED: "QUEUED",
  UNKNOWN: "UNKNOWN",
})

const terminalFailure = new Set([
  CoolifyDeploymentStatus.CANCELLED,
  CoolifyDeploymentStatus.FAILED,
  CoolifyDeploymentStatus.UNKNOWN,
])

export async function waitForCoolifyDeployment(input) {
  const attempts = input.maxAttempts ?? 180
  const intervalMs = input.intervalMs ?? 10_000
  const sleep = input.sleep ?? delay
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 360) {
    throw new TypeError("Coolify deployment attempt bound invalid")
  }
  if (!Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > 60_000) {
    throw new TypeError("Coolify deployment interval bound invalid")
  }
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const receipt = await input.read(input.deploymentUuid)
    if (
      typeof receipt !== "object" ||
      receipt === null ||
      receipt.deployment_uuid !== input.deploymentUuid
    ) {
      throw new TypeError("Coolify deployment receipt identity mismatch")
    }
    const status = classifyCoolifyDeploymentStatus(receipt.status)
    if (status === CoolifyDeploymentStatus.FINISHED) return status
    if (terminalFailure.has(status)) {
      throw new Error(`Coolify deployment stopped with ${status}`)
    }
    if (attempt + 1 < attempts) await sleep(intervalMs)
  }
  throw new Error("Coolify deployment did not finish before the bounded deadline")
}

export function classifyCoolifyDeploymentStatus(status) {
  switch (status) {
    case "cancelled":
      return CoolifyDeploymentStatus.CANCELLED
    case "failed":
      return CoolifyDeploymentStatus.FAILED
    case "finished":
      return CoolifyDeploymentStatus.FINISHED
    case "in_progress":
      return CoolifyDeploymentStatus.IN_PROGRESS
    case "queued":
      return CoolifyDeploymentStatus.QUEUED
    default:
      return CoolifyDeploymentStatus.UNKNOWN
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
