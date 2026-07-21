import { isUtf8 } from "node:buffer"
import { createHash } from "node:crypto"
import { isDeepStrictEqual } from "node:util"

import { z } from "zod"

import { canonicalJson } from "./canonical-json.js"
import { Sha256Schema } from "./control-plane-primitives.js"
import {
  parseProductionDependencyAuditReceipt,
  ProductionDependencyAuditDateSchema,
  ProductionDependencyAuditRuntimeSchema,
  ProductionDependencyAuditSourceSchema,
  PRODUCTION_DEPENDENCY_AUDIT_TARGET,
  type ProductionDependencyAuditReceipt,
} from "./production-dependency-audit-receipt.js"

const VerificationExpectedSchema = z.object({
  receiptSha256: Sha256Schema,
  target: z.enum([
    PRODUCTION_DEPENDENCY_AUDIT_TARGET.WORKER,
    PRODUCTION_DEPENDENCY_AUDIT_TARGET.MANAGER,
  ]),
  source: ProductionDependencyAuditSourceSchema,
  runtime: ProductionDependencyAuditRuntimeSchema,
  verificationDate: ProductionDependencyAuditDateSchema,
}).strict()

export const PRODUCTION_DEPENDENCY_AUDIT_MISMATCH_FIELD = {
  RECEIPT_SHA256: "RECEIPT_SHA256",
  CANONICAL_BYTES: "CANONICAL_BYTES",
  TARGET: "TARGET",
  SOURCE: "SOURCE",
  RUNTIME: "RUNTIME",
  RESIDUAL_EXPIRY: "RESIDUAL_EXPIRY",
} as const

export type ProductionDependencyAuditMismatchField =
  (typeof PRODUCTION_DEPENDENCY_AUDIT_MISMATCH_FIELD)[keyof typeof PRODUCTION_DEPENDENCY_AUDIT_MISMATCH_FIELD]
export type ProductionDependencyAuditVerificationExpected = z.output<typeof VerificationExpectedSchema>
export type ProductionDependencyAuditVerificationExpectedInput = z.input<typeof VerificationExpectedSchema>

export class ProductionDependencyAuditMismatchError extends Error {
  public override readonly name = "ProductionDependencyAuditMismatchError"

  public constructor(public readonly field: ProductionDependencyAuditMismatchField) {
    super(`Production dependency audit receipt mismatch: ${field}`)
  }
}

export function verifyProductionDependencyAuditReceiptBytes(
  rawBytes: string | Uint8Array,
  expectedInput: ProductionDependencyAuditVerificationExpectedInput,
): ProductionDependencyAuditReceipt {
  const expected = VerificationExpectedSchema.parse(expectedInput)
  const bytes = typeof rawBytes === "string" ? Buffer.from(rawBytes, "utf8") : Buffer.from(rawBytes)
  const actualSha256 = createHash("sha256").update(bytes).digest("hex")
  if (actualSha256 !== expected.receiptSha256) {
    throw new ProductionDependencyAuditMismatchError(PRODUCTION_DEPENDENCY_AUDIT_MISMATCH_FIELD.RECEIPT_SHA256)
  }

  if (!isUtf8(bytes)) {
    throw new ProductionDependencyAuditMismatchError(PRODUCTION_DEPENDENCY_AUDIT_MISMATCH_FIELD.CANONICAL_BYTES)
  }
  const text = bytes.toString("utf8")
  if (!text.startsWith("{") || !text.endsWith("\n") || text.endsWith("\n\n")) {
    throw new ProductionDependencyAuditMismatchError(PRODUCTION_DEPENDENCY_AUDIT_MISMATCH_FIELD.CANONICAL_BYTES)
  }

  let input: unknown
  try {
    input = JSON.parse(text)
  } catch {
    throw new ProductionDependencyAuditMismatchError(PRODUCTION_DEPENDENCY_AUDIT_MISMATCH_FIELD.CANONICAL_BYTES)
  }
  const receipt = parseProductionDependencyAuditReceipt(input)
  const canonicalBytes = Buffer.from(`${canonicalJson(receipt)}\n`, "utf8")
  if (!bytes.equals(canonicalBytes)) {
    throw new ProductionDependencyAuditMismatchError(PRODUCTION_DEPENDENCY_AUDIT_MISMATCH_FIELD.CANONICAL_BYTES)
  }
  if (receipt.target !== expected.target) {
    throw new ProductionDependencyAuditMismatchError(PRODUCTION_DEPENDENCY_AUDIT_MISMATCH_FIELD.TARGET)
  }
  if (!isDeepStrictEqual(receipt.source, expected.source)) {
    throw new ProductionDependencyAuditMismatchError(PRODUCTION_DEPENDENCY_AUDIT_MISMATCH_FIELD.SOURCE)
  }
  if (!isDeepStrictEqual(receipt.runtime, expected.runtime)) {
    throw new ProductionDependencyAuditMismatchError(PRODUCTION_DEPENDENCY_AUDIT_MISMATCH_FIELD.RUNTIME)
  }
  if (receipt.audit.residuals.some((residual) => residual.expiresOn <= expected.verificationDate)) {
    throw new ProductionDependencyAuditMismatchError(PRODUCTION_DEPENDENCY_AUDIT_MISMATCH_FIELD.RESIDUAL_EXPIRY)
  }
  return receipt
}
