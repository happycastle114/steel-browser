import { TextDecoder } from "node:util"
import { WORKER_IDENTITY_HEADER } from "@happycastle/steel-managed-shared"
import { Agent, request } from "undici"
import { z } from "zod"
import {
  WorkerAdapterError,
  WorkerIdentityMismatchError,
  WorkerHttpStatusError,
  WorkerProtocolError,
  WorkerTransportError,
} from "../domain/errors.js"
import type { InstanceId, WorkerId } from "../domain/ids.js"
import { WorkerTransportReason } from "../domain/states.js"

const CONTENT_TYPE = { JSON: "application/json" } as const
const WORKER_OPERATION_TIMEOUT_MAXIMUM_MS = 120_000

const BoundedJsonClientOptionsSchema = z
  .object({
    timeoutMilliseconds: z.number().int().min(1).max(WORKER_OPERATION_TIMEOUT_MAXIMUM_MS),
    maxResponseBytes: z.number().int().min(256).max(1_048_576),
  })
  .strict()
  .readonly()
export type BoundedJsonClientOptions = z.infer<typeof BoundedJsonClientOptionsSchema>

type JsonRequest<T, I> = {
  readonly workerId: WorkerId
  readonly identity: WorkerIdentityExpectation
  readonly url: URL
  readonly method: "GET" | "POST"
  readonly schema: z.ZodType<T, z.ZodTypeDef, I>
  readonly signal: AbortSignal
  readonly body?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly validateErrorResponse?: (body: unknown, headers: BoundedJsonResponse<T>["headers"]) => void
  readonly maxResponseBytes?: number
}

export type WorkerIdentityExpectation = {
  readonly workerId: WorkerId
  readonly instanceId?: InstanceId
}

export type BoundedJsonResponse<T> = {
  readonly body: T
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>
}

export class BoundedJsonClient {
  private readonly options: BoundedJsonClientOptions
  private readonly dispatcher: Agent

  public constructor(input: BoundedJsonClientOptions) {
    this.options = BoundedJsonClientOptionsSchema.parse(input)
    this.dispatcher = new Agent({
      connections: 2,
      pipelining: 1,
      connectTimeout: this.options.timeoutMilliseconds,
      headersTimeout: this.options.timeoutMilliseconds,
      bodyTimeout: this.options.timeoutMilliseconds,
      maxResponseSize: this.options.maxResponseBytes,
    })
  }

  public async send<T, I>(input: JsonRequest<T, I>): Promise<BoundedJsonResponse<T>> {
    const timeoutSignal = AbortSignal.timeout(this.options.timeoutMilliseconds)
    const combinedSignal = AbortSignal.any([input.signal, timeoutSignal])
    const maxResponseBytes = this.responseByteLimit(input.maxResponseBytes)
    try {
      const requestOptions = {
        dispatcher: this.dispatcher,
        ...(input.headers === undefined ? {} : { headers: input.headers }),
        method: input.method,
        signal: combinedSignal,
      } as const
      const response =
        input.body === undefined
          ? await request(input.url, requestOptions)
          : await request(input.url, {
              ...requestOptions,
              headers: {
                ...input.headers,
                "content-type": CONTENT_TYPE.JSON,
              },
              body: input.body,
            })
      this.requireIdentity(response.headers, input.identity)
      if (response.statusCode < 200 || response.statusCode >= 300) {
        const bytes = await response.body.bytes()
        this.assertResponseSize(bytes, maxResponseBytes, input.workerId)
        input.validateErrorResponse?.(this.decodeBody(bytes, input.workerId), response.headers)
        throw new WorkerHttpStatusError(input.workerId, response.statusCode)
      }
      const responseBytes = await response.body.bytes()
      this.assertResponseSize(responseBytes, maxResponseBytes, input.workerId)
      return {
        body: this.parseBody(responseBytes, input.schema, input.workerId),
        headers: response.headers,
      }
    } catch (error) {
      if (error instanceof WorkerAdapterError) throw error
      if (combinedSignal.aborted) {
        const options = error instanceof Error ? { cause: error } : undefined
        throw new WorkerTransportError(input.workerId, WorkerTransportReason.ABORTED, options)
      }
      const options = error instanceof Error ? { cause: error } : undefined
      throw new WorkerTransportError(input.workerId, WorkerTransportReason.NETWORK, options)
    }
  }

  private requireIdentity(
    headers: Readonly<Record<string, string | readonly string[] | undefined>>,
    expected: WorkerIdentityExpectation,
  ): void {
    assertWorkerIdentityHeaders(headers, expected)
  }

  public async close(): Promise<void> {
    await this.dispatcher.close()
  }

  private responseByteLimit(routeLimit: number | undefined): number {
    if (routeLimit === undefined) return this.options.maxResponseBytes
    if (!Number.isSafeInteger(routeLimit) || routeLimit < 1) {
      throw new TypeError("route response body limit must be a positive safe integer")
    }
    return Math.min(routeLimit, this.options.maxResponseBytes)
  }

  private assertResponseSize(bytes: Uint8Array, limit: number, workerId: WorkerId): void {
    if (bytes.byteLength > limit) {
      throw new WorkerProtocolError(workerId, "worker response exceeded route body limit")
    }
  }

  private parseBody<T, I>(
    bytes: Uint8Array,
    schema: z.ZodType<T, z.ZodTypeDef, I>,
    workerId: WorkerId,
  ): T {
    const decoded = this.decodeBody(bytes, workerId)
    const parsed = schema.safeParse(decoded)
    if (!parsed.success) {
      throw new WorkerProtocolError(workerId, "worker response schema mismatched", {
        cause: parsed.error,
      })
    }
    return parsed.data
  }

  private decodeBody(bytes: Uint8Array, workerId: WorkerId): unknown {
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof TypeError) {
        throw new WorkerProtocolError(workerId, "worker response was not valid UTF-8 JSON", {
          cause: error,
        })
      }
      throw error
    }
  }
}

export function assertWorkerIdentityHeaders(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
  expected: WorkerIdentityExpectation,
): void {
  const workerId = singleHeader(headers[WORKER_IDENTITY_HEADER.WORKER_ID])
  const instanceId = singleHeader(headers[WORKER_IDENTITY_HEADER.INSTANCE_ID])
  if (workerId === undefined || instanceId === undefined) {
    throw new WorkerProtocolError(expected.workerId, "worker response instance header missing")
  }
  if (expected.instanceId === undefined) return
  if (workerId !== expected.workerId || instanceId !== expected.instanceId) {
    throw new WorkerIdentityMismatchError(expected.workerId, expected.instanceId)
  }
}

function singleHeader(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined
}
