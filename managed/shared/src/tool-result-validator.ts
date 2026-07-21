import { z } from "zod"

import { ByteCountSchema } from "./control-plane-primitives.js"
import { RESULT_KIND } from "./control-plane-vocabulary.js"
import { ManagedTransportConfigSchema, type ManagedTransportConfig } from "./managed-transport-config.js"
import type { SelectedPublicOrigin } from "./public-urls.js"
import {
  createToolResultSchemas,
  type BinaryCompletion,
  type ManagedToolResult,
} from "./tool-result-schemas.js"

export const MANAGED_RESULT_VALIDATION = {
  VALIDATED: "VALIDATED",
  REJECTED: "REJECTED",
} as const
export const MANAGED_RESULT_REJECTION_REASON = {
  LIMIT_EXCEEDED: "LIMIT_EXCEEDED",
  INVALID_CONTRACT: "INVALID_CONTRACT",
} as const
export const MANAGED_RESULT_LIMIT = {
  TEXT_SOURCE_BYTES: "TEXT_SOURCE_BYTES",
  TEXT_DELIVERED_BYTES: "TEXT_DELIVERED_BYTES",
  BINARY_BYTES: "BINARY_BYTES",
  RETAINED_BYTES: "RETAINED_BYTES",
} as const

type ManagedResultLimit = (typeof MANAGED_RESULT_LIMIT)[keyof typeof MANAGED_RESULT_LIMIT]
type LimitRejection = Readonly<{
  readonly status: typeof MANAGED_RESULT_VALIDATION.REJECTED
  readonly reason: typeof MANAGED_RESULT_REJECTION_REASON.LIMIT_EXCEEDED
  readonly limit: ManagedResultLimit
  readonly maximumBytes: number
  readonly observedBytes: number
}>
type ContractRejection = Readonly<{
  readonly status: typeof MANAGED_RESULT_VALIDATION.REJECTED
  readonly reason: typeof MANAGED_RESULT_REJECTION_REASON.INVALID_CONTRACT
  readonly issues: readonly z.ZodIssue[]
}>
export type ManagedResultValidation<Output> =
  | Readonly<{ readonly status: typeof MANAGED_RESULT_VALIDATION.VALIDATED; readonly value: Output }>
  | LimitRejection
  | ContractRejection

const ResultSizeProbeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal(RESULT_KIND.TEXT),
    byteLength: ByteCountSchema,
    deliveredByteLength: ByteCountSchema,
  }).passthrough(),
  z.object({ kind: z.literal(RESULT_KIND.BINARY), byteLength: ByteCountSchema }).passthrough(),
])

function assertNever(value: never): never {
  throw new TypeError(`unreachable managed result variant: ${String(value)}`)
}

function limitRejection(
  limit: ManagedResultLimit,
  maximumBytes: number,
  observedBytes: number,
): LimitRejection {
  return {
    status: MANAGED_RESULT_VALIDATION.REJECTED,
    reason: MANAGED_RESULT_REJECTION_REASON.LIMIT_EXCEEDED,
    limit,
    maximumBytes,
    observedBytes,
  }
}

function findLimitRejection(input: unknown, transport: ManagedTransportConfig): LimitRejection | undefined {
  const probe = ResultSizeProbeSchema.safeParse(input)
  if (!probe.success) return undefined
  switch (probe.data.kind) {
    case RESULT_KIND.TEXT:
      if (probe.data.byteLength > transport.httpBodyBytes) {
        return limitRejection(MANAGED_RESULT_LIMIT.TEXT_SOURCE_BYTES, transport.httpBodyBytes, probe.data.byteLength)
      }
      if (probe.data.deliveredByteLength > transport.textBytes) {
        return limitRejection(
          MANAGED_RESULT_LIMIT.TEXT_DELIVERED_BYTES,
          transport.textBytes,
          probe.data.deliveredByteLength,
        )
      }
      return undefined
    case RESULT_KIND.BINARY:
      if (probe.data.byteLength > transport.binaryBytes) {
        return limitRejection(MANAGED_RESULT_LIMIT.BINARY_BYTES, transport.binaryBytes, probe.data.byteLength)
      }
      if (probe.data.byteLength > transport.resultBytes) {
        return limitRejection(MANAGED_RESULT_LIMIT.RETAINED_BYTES, transport.resultBytes, probe.data.byteLength)
      }
      return undefined
    default:
      return assertNever(probe.data)
  }
}

function validateWithLimits<Output, Definition extends z.ZodTypeDef, Input>(
  schema: z.ZodType<Output, Definition, Input>,
  input: unknown,
  transport: ManagedTransportConfig,
): ManagedResultValidation<Output> {
  const exceeded = findLimitRejection(input, transport)
  if (exceeded !== undefined) return exceeded
  const result = schema.safeParse(input)
  if (result.success) return { status: MANAGED_RESULT_VALIDATION.VALIDATED, value: result.data }
  return {
    status: MANAGED_RESULT_VALIDATION.REJECTED,
    reason: MANAGED_RESULT_REJECTION_REASON.INVALID_CONTRACT,
    issues: Object.freeze([...result.error.issues]),
  }
}

export function createManagedResultValidator(
  selectedOrigin: SelectedPublicOrigin,
  transportInput: ManagedTransportConfig,
) {
  const transport = ManagedTransportConfigSchema.parse(transportInput)
  const schemas = createToolResultSchemas(selectedOrigin, transport)
  return Object.freeze({
    schemas,
    validateBinaryCompletion: (input: unknown): ManagedResultValidation<BinaryCompletion> =>
      validateWithLimits(schemas.BinaryCompletionSchema, input, transport),
    validateToolResult: (input: unknown): ManagedResultValidation<ManagedToolResult> =>
      validateWithLimits(schemas.ManagedToolResultSchema, input, transport),
  })
}
