const sha256Pattern = /^[0-9a-f]{64}$/u
const ociDigestPattern = /^sha256:[0-9a-f]{64}$/u
const gitRevisionPattern = /^[0-9a-f]{40}$/u
const digestImagePattern = /^[a-z0-9][a-z0-9._/-]*@sha256:[0-9a-f]{64}$/u
const browserVersionPattern = /^[0-9]+(?:\.[0-9]+){3}$/u

export function buildReleaseEvidence(input) {
  const manager = parseBuildReceipt(input.managerReceipt, "manager")
  const worker = parseBuildReceipt(input.workerReceipt, "worker")
  requireSha256(input.toolchainLockSha256, "toolchain lock")
  requireSha256(input.workerRuntimeStrategyReceiptSha256, "worker runtime strategy receipt")
  requireGitRevision(input.upstreamRevision, "upstream revision")
  if (!browserVersionPattern.test(input.browserVersion)) {
    throw new TypeError("invalid browser version")
  }
  if (
    manager.sourceRevision !== worker.sourceRevision ||
    manager.sourceDateEpoch !== worker.sourceDateEpoch
  ) {
    throw new TypeError("manager and worker source receipts drift")
  }
  if (manager.candidateImage === worker.candidateImage) {
    throw new TypeError("manager and worker images must be distinct")
  }
  const auditDigests = new Set([
    manager.productionAuditReceiptSha256,
    worker.productionAuditReceiptSha256,
    input.workerRuntimeStrategyReceiptSha256,
  ])
  if (auditDigests.size !== 3) throw new TypeError("release receipt digests must be distinct")
  const generatedAt = sourceDateEpochToIso(manager.sourceDateEpoch)
  return deepFreeze({
    schemaVersion: 1,
    evidenceMode: "CONFIG_FILE",
    body: {
      managerImage: imageEvidence(manager),
      workerImage: imageEvidence(worker),
      browserVersion: input.browserVersion,
      source: {
        managedRevision: manager.sourceRevision,
        upstreamRevision: input.upstreamRevision,
        sourceDateEpoch: manager.sourceDateEpoch,
      },
      toolchainLockSha256: input.toolchainLockSha256,
      managerProductionAuditReceiptSha256: manager.productionAuditReceiptSha256,
      workerProductionAuditReceiptSha256: worker.productionAuditReceiptSha256,
      workerRuntimeStrategyReceiptSha256: input.workerRuntimeStrategyReceiptSha256,
      generatedAt,
    },
  })
}

export function serializeReleaseEvidence(evidence) {
  verifyReleaseEvidence(evidence)
  return JSON.stringify(evidence)
}

export function verifyReleaseEvidence(evidence) {
  if (!isRecord(evidence) || evidence.schemaVersion !== 1 || evidence.evidenceMode !== "CONFIG_FILE") {
    throw new TypeError("invalid release evidence envelope")
  }
  if (!isRecord(evidence.body) || !isRecord(evidence.body.source)) {
    throw new TypeError("invalid release evidence body")
  }
  const manager = parseImageEvidence(evidence.body.managerImage, "manager")
  const worker = parseImageEvidence(evidence.body.workerImage, "worker")
  if (manager.ref === worker.ref) throw new TypeError("release images must be distinct")
  if (!browserVersionPattern.test(evidence.body.browserVersion)) {
    throw new TypeError("invalid release browser version")
  }
  requireGitRevision(evidence.body.source.managedRevision, "managed revision")
  requireGitRevision(evidence.body.source.upstreamRevision, "upstream revision")
  const generatedAt = sourceDateEpochToIso(evidence.body.source.sourceDateEpoch)
  if (evidence.body.generatedAt !== generatedAt) throw new TypeError("release timestamp drift")
  for (const [field, value] of [
    ["toolchain lock", evidence.body.toolchainLockSha256],
    ["manager audit", evidence.body.managerProductionAuditReceiptSha256],
    ["worker audit", evidence.body.workerProductionAuditReceiptSha256],
    ["worker strategy", evidence.body.workerRuntimeStrategyReceiptSha256],
  ]) requireSha256(value, field)
  return evidence
}

function parseBuildReceipt(receipt, field) {
  if (!isRecord(receipt)) throw new TypeError(`${field} build receipt missing`)
  const image = parseImageEvidence({
    ref: receipt.candidateImage,
    indexDigest: receipt.candidateIndexDigest,
    platformDigest: receipt.candidatePlatformDigest,
    configDigest: receipt.candidateConfigDigest,
  }, field)
  requireSha256(receipt.productionAuditReceiptSha256, `${field} audit receipt`)
  requireGitRevision(receipt.sourceRevision, `${field} source revision`)
  sourceDateEpochToIso(receipt.sourceDateEpoch)
  return Object.freeze({
    candidateConfigDigest: image.configDigest,
    candidateImage: image.ref,
    candidateIndexDigest: image.indexDigest,
    candidatePlatformDigest: image.platformDigest,
    productionAuditReceiptSha256: receipt.productionAuditReceiptSha256,
    sourceDateEpoch: receipt.sourceDateEpoch,
    sourceRevision: receipt.sourceRevision,
  })
}

function parseImageEvidence(value, field) {
  if (!isRecord(value) || !digestImagePattern.test(value.ref)) {
    throw new TypeError(`${field} image must be digest-pinned`)
  }
  const digests = [value.indexDigest, value.platformDigest, value.configDigest]
  if (!digests.every((digest) => typeof digest === "string" && ociDigestPattern.test(digest))) {
    throw new TypeError(`${field} image digests are invalid`)
  }
  if (!value.ref.endsWith(`@${value.indexDigest}`) || new Set(digests).size !== 3) {
    throw new TypeError(`${field} image digest binding drift`)
  }
  return Object.freeze({
    ref: value.ref,
    indexDigest: value.indexDigest,
    platformDigest: value.platformDigest,
    configDigest: value.configDigest,
  })
}

function imageEvidence(receipt) {
  return {
    ref: receipt.candidateImage,
    indexDigest: receipt.candidateIndexDigest,
    platformDigest: receipt.candidatePlatformDigest,
    configDigest: receipt.candidateConfigDigest,
  }
}

function sourceDateEpochToIso(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,19}$/u.test(value)) {
    throw new TypeError("invalid source date epoch")
  }
  const seconds = Number(value)
  const milliseconds = seconds * 1_000
  if (!Number.isSafeInteger(seconds) || !Number.isSafeInteger(milliseconds)) {
    throw new TypeError("source date epoch exceeds safe range")
  }
  const date = new Date(milliseconds)
  if (!Number.isFinite(date.getTime())) throw new TypeError("source date epoch is invalid")
  return date.toISOString()
}

function requireSha256(value, field) {
  if (typeof value !== "string" || !sha256Pattern.test(value)) {
    throw new TypeError(`${field} must be SHA-256`)
  }
}

function requireGitRevision(value, field) {
  if (typeof value !== "string" || !gitRevisionPattern.test(value)) {
    throw new TypeError(`${field} must be a Git revision`)
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function deepFreeze(value) {
  for (const nested of Object.values(value)) {
    if (isRecord(nested)) deepFreeze(nested)
  }
  return Object.freeze(value)
}
