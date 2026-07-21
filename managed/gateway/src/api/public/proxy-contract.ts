import { z } from "zod"
import { WorkerIdentityMismatchError } from "../../domain/errors.js"
import type { WorkerDescriptor } from "../../registry/registry-model.js"
import { canonicalPublicPathname } from "./path-validation.js"

export class WorkerRestTimeoutError extends Error {
  public override readonly name = "WorkerRestTimeoutError"
}

export class WorkerRestBadResponseError extends Error {
  public override readonly name = "WorkerRestBadResponseError"

  public constructor(public readonly upstreamStatusCode?: number, options?: ErrorOptions) {
    super("worker returned an unusable response", options)
  }
}

export class WorkerRestAbortedError extends Error {
  public override readonly name = "WorkerRestAbortedError"
}

export class PublicRequestBodyTooLargeError extends Error {
  public override readonly name = "PublicRequestBodyTooLargeError"

  public constructor() {
    super("public request body exceeded capacity")
  }
}

export interface WorkerGenerationVerifier {
  assertCurrent(worker: WorkerDescriptor, signal: AbortSignal): Promise<void>
}

export type WorkerPrivateIdentity = Readonly<{ managerInstanceId: string; poolId: string }>

const WorkerRestProxyOptionsSchema = z
  .object({
    identity: z
      .object({
        managerInstanceId: z.string().uuid(),
        poolId: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/u),
      })
      .strict()
      .readonly(),
    maxResponseBytes: z.number().int().min(1).max(16_777_216),
    maxRequestBytes: z.number().int().min(1).max(16_777_216),
    timeoutMilliseconds: z.number().int().min(1).max(30_000),
  })
  .strict()
  .readonly()

export type WorkerRestProxyOptions = z.input<typeof WorkerRestProxyOptionsSchema> & {
  readonly verifier: WorkerGenerationVerifier
}

export function parseWorkerRestProxyOptions(input: WorkerRestProxyOptions) {
  return WorkerRestProxyOptionsSchema.parse({
    identity: input.identity,
    maxResponseBytes: input.maxResponseBytes,
    maxRequestBytes: input.maxRequestBytes,
    timeoutMilliseconds: input.timeoutMilliseconds,
  })
}

export function workerRestErrorOptions(error: unknown): ErrorOptions | undefined {
  return error instanceof Error ? { cause: error } : undefined
}

export function workerRestUrl(origin: string, pathAndQuery: string): URL {
  if (canonicalPublicPathname(pathAndQuery) === undefined) throw new WorkerRestBadResponseError()
  const originUrl = new URL(origin)
  const url = new URL(pathAndQuery, originUrl)
  if (url.origin !== originUrl.origin || url.hash !== "") throw new WorkerRestBadResponseError()
  return url
}

export function normalizeStreamingTransportError(
  error: unknown,
  signal: AbortSignal,
  timedOut: boolean,
): Error {
  if (error instanceof WorkerIdentityMismatchError || error instanceof WorkerRestBadResponseError) {
    return error
  }
  if (timedOut && !signal.aborted) {
    return new WorkerRestTimeoutError("worker request timed out", workerRestErrorOptions(error))
  }
  if (signal.aborted) {
    return new WorkerRestAbortedError("public request was aborted", workerRestErrorOptions(error))
  }
  return new WorkerRestBadResponseError(undefined, workerRestErrorOptions(error))
}

const UndiciErrorCode = {
  BODY_TIMEOUT: "UND_ERR_BODY_TIMEOUT",
  HEADERS_TIMEOUT: "UND_ERR_HEADERS_TIMEOUT",
} as const

export function isWorkerRestTimeoutError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (
      error.code === UndiciErrorCode.BODY_TIMEOUT ||
      error.code === UndiciErrorCode.HEADERS_TIMEOUT
    )
  )
}
