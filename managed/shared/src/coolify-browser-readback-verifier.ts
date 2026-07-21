import { createHash } from "node:crypto"

import { z } from "zod"

import {
  DigestPinnedImageReferenceSchema,
  parseCoolifyBrowserReadbackReceipt,
  type CoolifyBrowserReadbackReceipt,
} from "./coolify-browser-readback.js"
import { GitCommitShaSchema, Sha256Schema } from "./control-plane-primitives.js"

const ReceiptVerificationExpectedSchema = z.object({
  receiptSha256: Sha256Schema,
  candidate: DigestPinnedImageReferenceSchema,
  sourceRevision: GitCommitShaSchema,
}).strict()

export const COOLIFY_BROWSER_READBACK_MISMATCH_FIELD = {
  RECEIPT_SHA256: "RECEIPT_SHA256",
  CANDIDATE: "CANDIDATE",
  SOURCE_REVISION: "SOURCE_REVISION",
} as const
export type CoolifyBrowserReadbackMismatchField =
  (typeof COOLIFY_BROWSER_READBACK_MISMATCH_FIELD)[keyof typeof COOLIFY_BROWSER_READBACK_MISMATCH_FIELD]
export type CoolifyBrowserReadbackExpected = z.output<typeof ReceiptVerificationExpectedSchema>
export type CoolifyBrowserReadbackExpectedInput = z.input<typeof ReceiptVerificationExpectedSchema>

export class CoolifyBrowserReadbackMismatchError extends Error {
  override readonly name = "CoolifyBrowserReadbackMismatchError"
  public constructor(readonly field: CoolifyBrowserReadbackMismatchField) {
    super(`Coolify browser readback mismatch: ${field}`)
  }
}

export function verifyCoolifyBrowserReadbackReceiptBytes(
  rawBytes: string | Uint8Array,
  expectedInput: CoolifyBrowserReadbackExpectedInput,
): CoolifyBrowserReadbackReceipt {
  const expected = ReceiptVerificationExpectedSchema.parse(expectedInput)
  const bytes = typeof rawBytes === "string" ? Buffer.from(rawBytes, "utf8") : Buffer.from(rawBytes)
  const actualSha256 = createHash("sha256").update(bytes).digest("hex")
  if (actualSha256 !== expected.receiptSha256) {
    throw new CoolifyBrowserReadbackMismatchError(COOLIFY_BROWSER_READBACK_MISMATCH_FIELD.RECEIPT_SHA256)
  }
  const input: unknown = JSON.parse(bytes.toString("utf8"))
  const receipt = parseCoolifyBrowserReadbackReceipt(input)
  if (receipt.image.candidate !== expected.candidate) {
    throw new CoolifyBrowserReadbackMismatchError(COOLIFY_BROWSER_READBACK_MISMATCH_FIELD.CANDIDATE)
  }
  if (receipt.source.revision !== expected.sourceRevision) {
    throw new CoolifyBrowserReadbackMismatchError(COOLIFY_BROWSER_READBACK_MISMATCH_FIELD.SOURCE_REVISION)
  }
  return receipt
}
