import { readFile } from "node:fs/promises"
import { IMAGE_PLATFORM, verifyRuntimeStrategyReceiptBytes } from "./runtime-strategy-gate.js"

const receiptPath = process.env["MANAGED_RUNTIME_STRATEGY_RECEIPT"]
const receiptSha256 = process.env["MANAGED_RUNTIME_STRATEGY_RECEIPT_SHA256"]
const sourceRevision = process.env["MANAGED_SOURCE_REVISION"]
const candidateImage = process.env["MANAGED_WORKER_CANDIDATE_IMAGE"]
const rawPlatform = process.env["MANAGED_WORKER_IMAGE_PLATFORM"]
const platform = rawPlatform === IMAGE_PLATFORM.AMD64 || rawPlatform === IMAGE_PLATFORM.ARM64
  ? rawPlatform
  : undefined
const productionAuditReceiptSha256 = process.env["MANAGED_PRODUCTION_AUDIT_RECEIPT_SHA256"]
const upstreamCombinedBaseImage = process.env["MANAGED_UPSTREAM_COMBINED_BASE_IMAGE"]
if (
  receiptPath === undefined ||
  receiptSha256 === undefined ||
  sourceRevision === undefined ||
  candidateImage === undefined ||
  platform === undefined ||
  productionAuditReceiptSha256 === undefined ||
  upstreamCombinedBaseImage === undefined
) {
  process.exitCode = 64
} else {
  const bytes = await readFile(receiptPath)
  verifyRuntimeStrategyReceiptBytes(bytes, {
    candidateImage,
    platform,
    productionAuditReceiptSha256,
    receiptSha256,
    sourceRevision,
    upstreamCombinedBaseImage,
  })
}
