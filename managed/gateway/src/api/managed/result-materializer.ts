import { createHash } from "node:crypto"

import {
  MANAGED_ERROR_CODE,
  MANAGED_RESULT_REJECTION_REASON,
  MANAGED_RESULT_VALIDATION,
  RESULT_FAILURE_RELEASE_REASON,
  TOOL_OUTPUT_POLICY,
  buildResultDownloadUrl,
  canonicalJson,
  createManagedResultValidator,
  createRetainedBinaryResultSchema,
  createToolDefinitionRegistry,
  type ControlPlaneConfig,
  type JsonValue,
  JsonValueSchema,
  type ManagedResultValidation,
  type ManagedTransportConfig,
  type SelectedPublicOrigin,
} from "@happycastle/steel-managed-shared"
import { z } from "zod"
import { assertNever } from "../../domain/exhaustive.js"
import type { ManagedExecutionCompletion } from "./execution-contract.js"
import { isSafeNavigationOutput } from "./output-safety.js"
import {
  RETAINED_RESULT_CONTENT,
  type RetainedResultRecord,
} from "./retained-result-store.js"
import { ManagedTransportError } from "./transport-error.js"

export class ResultMaterializationError extends ManagedTransportError {
  public constructor(
    code: typeof MANAGED_ERROR_CODE.RESULT_TOO_LARGE | typeof MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE,
    public readonly releaseReason: typeof RESULT_FAILURE_RELEASE_REASON.LIMIT_EXCEEDED |
      typeof RESULT_FAILURE_RELEASE_REASON.INVALID_CONTRACT,
  ) {
    super(code, code === MANAGED_ERROR_CODE.RESULT_TOO_LARGE
      ? "The tool result exceeds the configured limit"
      : "The control plane returned an invalid response")
  }
}

export type MaterializedResult = Readonly<{
  readonly byteLength: number
  readonly record: RetainedResultRecord
}>

export function materializeResult(input: Readonly<{
  readonly completion: ManagedExecutionCompletion
  readonly creatorId: RetainedResultRecord["creatorId"]
  readonly selectedOrigin: SelectedPublicOrigin
  readonly config: ControlPlaneConfig
  readonly transport: ManagedTransportConfig
}>): MaterializedResult {
  const { completion } = input
  const definition = createToolDefinitionRegistry(input.selectedOrigin, input.transport)[completion.action.tool.name]
  switch (definition.outputPolicy) {
    case TOOL_OUTPUT_POLICY.BINARY_RETAINED:
      return materializeBinary(input)
    case TOOL_OUTPUT_POLICY.STRUCTURED:
    case TOOL_OUTPUT_POLICY.TEXT_BOUNDED:
    case TOOL_OUTPUT_POLICY.LIVE_INSTANCE_BOUND:
      return materializeJson(input, definition.outputSchema)
    default:
      return assertNever(definition.outputPolicy)
  }
}

function materializeJson(
  input: Parameters<typeof materializeResult>[0],
  outputSchema: z.ZodType<unknown, z.ZodTypeDef, unknown>,
): MaterializedResult {
  if (input.completion.binaryBytes !== undefined) throw invalidContract()
  const validated = createManagedResultValidator(input.selectedOrigin, input.transport)
    .validateToolResult(input.completion.output)
  validatedValue(validated)
  const exact = outputSchema.safeParse(input.completion.output)
  if (!exact.success) throw invalidContract()
  const output = canonicalJsonValue(exact.data)
  if (!isSafeNavigationOutput(output)) throw invalidContract()
  const json = canonicalJson(output)
  const byteLength = new TextEncoder().encode(json).byteLength
  if (byteLength > Math.min(input.transport.httpBodyBytes, input.transport.resultBytes)) throw limitExceeded()
  return {
    byteLength,
    record: Object.freeze({
      ...baseRecord(input, output),
      content: RETAINED_RESULT_CONTENT.JSON,
    }),
  }
}

function materializeBinary(input: Parameters<typeof materializeResult>[0]): MaterializedResult {
  const validated = createManagedResultValidator(input.selectedOrigin, input.transport)
    .validateBinaryCompletion(input.completion.output)
  const completion = validatedValue(validated)
  const sourceBytes = input.completion.binaryBytes
  if (sourceBytes === undefined || sourceBytes.buffer instanceof SharedArrayBuffer) throw invalidContract()
  const bytes = Uint8Array.from(sourceBytes)
  const digest = createHash("sha256").update(bytes).digest("hex")
  if (completion.byteLength !== bytes.byteLength || completion.sha256 !== digest) throw invalidContract()
  const output = createRetainedBinaryResultSchema({
    selectedOrigin: input.selectedOrigin,
    transport: input.transport,
    resultId: input.completion.resultId,
    completedAtMs: input.completion.completedAtMs,
    resultTtlMs: input.config.aiResultTtlMs,
  }).parse({
    ...completion,
    resultId: input.completion.resultId,
    expiresAt: new Date(input.completion.completedAtMs + input.config.aiResultTtlMs).toISOString(),
    downloadUrl: buildResultDownloadUrl(input.selectedOrigin, input.completion.resultId),
  })
  return {
    byteLength: bytes.byteLength,
    record: Object.freeze({
      ...baseRecord(input, canonicalJsonValue(output)),
      content: RETAINED_RESULT_CONTENT.BINARY,
      bytes,
      contentType: output.contentType,
    }),
  }
}

function baseRecord(input: Parameters<typeof materializeResult>[0], output: JsonValue) {
  return {
    resultId: input.completion.resultId,
    action: input.completion.action,
    ownerId: input.completion.ownerId,
    creatorId: input.creatorId,
    selectedOrigin: input.selectedOrigin,
    completedAtMs: input.completion.completedAtMs,
    expiresAtMs: input.completion.completedAtMs + input.config.aiResultTtlMs,
    output,
  } as const
}

function canonicalJsonValue(value: unknown): JsonValue {
  return JsonValueSchema.parse(JSON.parse(canonicalJson(value)))
}

function validatedValue<Output>(validation: ManagedResultValidation<Output>): Output {
  if (validation.status === MANAGED_RESULT_VALIDATION.VALIDATED) return validation.value
  if (validation.reason === MANAGED_RESULT_REJECTION_REASON.LIMIT_EXCEEDED) throw limitExceeded()
  throw invalidContract()
}

function invalidContract(): ResultMaterializationError {
  return new ResultMaterializationError(
    MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE,
    RESULT_FAILURE_RELEASE_REASON.INVALID_CONTRACT,
  )
}

function limitExceeded(): ResultMaterializationError {
  return new ResultMaterializationError(
    MANAGED_ERROR_CODE.RESULT_TOO_LARGE,
    RESULT_FAILURE_RELEASE_REASON.LIMIT_EXCEEDED,
  )
}
