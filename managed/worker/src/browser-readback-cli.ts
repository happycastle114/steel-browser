import { readFile } from "node:fs/promises"
import { z } from "zod"
import { verifyCoolifyBrowserReadbackReceiptBytes } from "./browser-readback-gate.js"

const PromotionEnvironmentSchema = z.object({
  MANAGED_WORKER_BROWSER_READBACK_RECEIPT: z.string().min(1),
  MANAGED_WORKER_BROWSER_READBACK_RECEIPT_SHA256: z.string().regex(/^[0-9a-f]{64}$/u),
  MANAGED_WORKER_CANDIDATE_IMAGE: z.string().min(1),
  MANAGED_SOURCE_REVISION: z.string().regex(/^[0-9a-f]{40}$/u),
})

const environment = PromotionEnvironmentSchema.parse(process.env)
const serializedReceipt = await readFile(environment.MANAGED_WORKER_BROWSER_READBACK_RECEIPT)
const receipt = verifyCoolifyBrowserReadbackReceiptBytes(serializedReceipt, {
  candidate: environment.MANAGED_WORKER_CANDIDATE_IMAGE,
  receiptSha256: environment.MANAGED_WORKER_BROWSER_READBACK_RECEIPT_SHA256,
  sourceRevision: environment.MANAGED_SOURCE_REVISION,
})

process.stdout.write(
  `verified candidate=${receipt.image.candidate} chromium=${receipt.browser.version} capturedAt=${receipt.evidence.capturedAt}\n`,
)
