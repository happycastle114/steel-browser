import { createHash } from "node:crypto"

import {
  AI_ACTION_REQUEST_SCHEMA,
  MANAGED_RESULT_VALIDATION,
  PrincipalIdSchema,
  RESULT_KIND,
  ResultIdSchema,
  TOOL_OUTPUT_POLICY,
  canonicalJson,
  createManagedResultValidator,
  createRetainedBinaryResultSchema,
  createToolDefinitionRegistry,
  type ControlPlaneConfig,
  type ManagedTransportConfig,
  type ResultId,
  type SelectedPublicOrigin,
} from "@happycastle/steel-managed-shared"
import { assertNever } from "../../domain/exhaustive.js"
import { isSafeNavigationOutput } from "./output-safety.js"
import {
  RETAINED_RESULT_CONTENT,
  type RetainedBinaryResult,
  type RetainedResultRecord,
} from "./retained-result-store.js"
import { COMPLETED_ACTION_KIND, type CompletedAction } from "./service-contract.js"

export function validateRetainedResult(input: Readonly<{
  readonly record: RetainedResultRecord
  readonly expectedResultId: ResultId
  readonly selectedOrigin: SelectedPublicOrigin
  readonly config: ControlPlaneConfig
  readonly transport: ManagedTransportConfig
}>): CompletedAction {
  const { record } = input
  requireBaseRecord(record, input)
  const action = AI_ACTION_REQUEST_SCHEMA.parse(record.action)
  const definition = createToolDefinitionRegistry(input.selectedOrigin, input.transport)[action.tool.name]
  switch (definition.outputPolicy) {
    case TOOL_OUTPUT_POLICY.BINARY_RETAINED:
      if (record.content !== RETAINED_RESULT_CONTENT.BINARY) throw new TypeError("binary record content mismatch")
      return validateBinary(record, input)
    case TOOL_OUTPUT_POLICY.STRUCTURED:
    case TOOL_OUTPUT_POLICY.TEXT_BOUNDED:
    case TOOL_OUTPUT_POLICY.LIVE_INSTANCE_BOUND: {
      if (record.content !== RETAINED_RESULT_CONTENT.JSON) throw new TypeError("JSON record content mismatch")
      const broad = createManagedResultValidator(input.selectedOrigin, input.transport).validateToolResult(record.output)
      if (broad.status !== MANAGED_RESULT_VALIDATION.VALIDATED || !definition.outputSchema.safeParse(record.output).success) {
        throw new TypeError("retained JSON result contract mismatch")
      }
      if (!isSafeNavigationOutput(record.output)) throw new TypeError("unsafe retained navigation URL")
      const byteLength = new TextEncoder().encode(canonicalJson(record.output)).byteLength
      if (byteLength > Math.min(input.transport.httpBodyBytes, input.transport.resultBytes)) {
        throw new RangeError("retained JSON result exceeds configured limits")
      }
      return Object.freeze({
        kind: COMPLETED_ACTION_KIND.JSON,
        resultId: record.resultId,
        action,
        output: record.output,
      })
    }
    default:
      return assertNever(definition.outputPolicy)
  }
}

function validateBinary(
  record: RetainedBinaryResult,
  input: Parameters<typeof validateRetainedResult>[0],
): CompletedAction {
  const descriptor = createRetainedBinaryResultSchema({
    selectedOrigin: input.selectedOrigin,
    transport: input.transport,
    resultId: record.resultId,
    completedAtMs: record.completedAtMs,
    resultTtlMs: input.config.aiResultTtlMs,
  }).parse(record.output)
  if (descriptor.kind !== RESULT_KIND.BINARY || descriptor.contentType !== record.contentType) {
    throw new TypeError("retained binary media mismatch")
  }
  if (record.bytes.buffer instanceof SharedArrayBuffer) throw new TypeError("shared binary storage is forbidden")
  const bytes = Uint8Array.from(record.bytes)
  const digest = createHash("sha256").update(bytes).digest("hex")
  if (descriptor.byteLength !== bytes.byteLength || descriptor.sha256 !== digest) {
    throw new TypeError("retained binary digest mismatch")
  }
  return Object.freeze({
    kind: COMPLETED_ACTION_KIND.BINARY,
    resultId: record.resultId,
    action: record.action,
    output: record.output,
    bytes,
    contentType: descriptor.contentType,
  })
}

function requireBaseRecord(
  record: RetainedResultRecord,
  input: Parameters<typeof validateRetainedResult>[0],
): void {
  if (ResultIdSchema.parse(record.resultId) !== input.expectedResultId) throw new TypeError("retained result ID mismatch")
  PrincipalIdSchema.parse(record.ownerId)
  PrincipalIdSchema.parse(record.creatorId)
  if (record.selectedOrigin !== input.selectedOrigin) throw new TypeError("retained result origin mismatch")
  if (!Number.isSafeInteger(record.completedAtMs) || record.completedAtMs < 0) throw new TypeError("invalid completion time")
  if (record.expiresAtMs !== record.completedAtMs + input.config.aiResultTtlMs) throw new TypeError("invalid result expiry")
}
