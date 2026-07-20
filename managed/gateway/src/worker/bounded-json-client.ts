import { TextDecoder } from "node:util"
import { Agent, request } from "undici"
import { z } from "zod"
import {
  WorkerAdapterError,
  WorkerHttpStatusError,
  WorkerProtocolError,
  WorkerTransportError,
} from "../domain/errors.js"
import type { WorkerId } from "../domain/ids.js"
import { WorkerTransportReason } from "../domain/states.js"

const CONTENT_TYPE = { JSON: "application/json" } as const

const BoundedJsonClientOptionsSchema = z
  .object({
    timeoutMilliseconds: z.number().int().min(1).max(30_000),
    maxResponseBytes: z.number().int().min(256).max(1_048_576),
  })
  .strict()
  .readonly()
export type BoundedJsonClientOptions = z.infer<typeof BoundedJsonClientOptionsSchema>

type JsonRequest<T, I> = {
  readonly workerId: WorkerId
  readonly url: URL
  readonly method: "GET" | "POST"
  readonly schema: z.ZodType<T, z.ZodTypeDef, I>
  readonly signal: AbortSignal
  readonly body?: string
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
    try {
      const requestOptions = {
        dispatcher: this.dispatcher,
        method: input.method,
        signal: combinedSignal,
      } as const
      const response =
        input.body === undefined
          ? await request(input.url, requestOptions)
          : await request(input.url, {
              ...requestOptions,
              headers: { "content-type": CONTENT_TYPE.JSON },
              body: input.body,
            })
      if (response.statusCode < 200 || response.statusCode >= 300) {
        await response.body.dump({ limit: this.options.maxResponseBytes, signal: combinedSignal })
        throw new WorkerHttpStatusError(input.workerId, response.statusCode)
      }
      return {
        body: this.parseBody(await response.body.bytes(), input.schema, input.workerId),
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

  public async close(): Promise<void> {
    await this.dispatcher.close()
  }

  private parseBody<T, I>(
    bytes: Uint8Array,
    schema: z.ZodType<T, z.ZodTypeDef, I>,
    workerId: WorkerId,
  ): T {
    let decoded: unknown
    try {
      decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof TypeError) {
        throw new WorkerProtocolError(workerId, "worker response was not valid UTF-8 JSON", {
          cause: error,
        })
      }
      throw error
    }
    const parsed = schema.safeParse(decoded)
    if (!parsed.success) {
      throw new WorkerProtocolError(workerId, "worker response schema mismatched", {
        cause: parsed.error,
      })
    }
    return parsed.data
  }
}
