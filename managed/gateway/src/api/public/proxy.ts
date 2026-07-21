import { Readable } from "node:stream"
import { Agent, request } from "undici"
import { WorkerIdentityMismatchError } from "../../domain/errors.js"
import type { WorkerDescriptor } from "../../registry/registry-model.js"
import { PublicHttpMethod, type PublicStreamingHttpResponse, type UpstreamHttpResponse } from "./schemas.js"
import { workerRequestHeaders, workerResponseHeaders } from "./proxy-headers.js"
import {
  isWorkerRestTimeoutError,
  normalizeStreamingTransportError,
  parseWorkerRestProxyOptions,
  PublicRequestBodyTooLargeError,
  WorkerRestAbortedError,
  WorkerRestBadResponseError,
  WorkerRestTimeoutError,
  workerRestErrorOptions,
  workerRestUrl,
  type WorkerGenerationVerifier,
  type WorkerPrivateIdentity,
  type WorkerRestProxyOptions,
} from "./proxy-contract.js"

export { workerRequestHeaders } from "./proxy-headers.js"
export {
  PublicRequestBodyTooLargeError,
  WorkerRestAbortedError,
  WorkerRestBadResponseError,
  WorkerRestTimeoutError,
} from "./proxy-contract.js"
export type {
  WorkerGenerationVerifier,
  WorkerPrivateIdentity,
  WorkerRestProxyOptions,
} from "./proxy-contract.js"

export class WorkerRestProxy {
  private readonly dispatcher: Agent
  private readonly identity: WorkerPrivateIdentity
  private readonly maxResponseBytes: number
  private readonly maxRequestBytes: number
  private readonly streamCancels = new Set<() => void>()
  private readonly timeoutMilliseconds: number
  private readonly verifier: WorkerGenerationVerifier

  public constructor(input: WorkerRestProxyOptions) {
    const options = parseWorkerRestProxyOptions(input)
    this.identity = options.identity
    this.maxResponseBytes = options.maxResponseBytes
    this.maxRequestBytes = options.maxRequestBytes
    this.timeoutMilliseconds = options.timeoutMilliseconds
    this.verifier = input.verifier
    this.dispatcher = new Agent({
      connections: 16,
      pipelining: 1,
      connectTimeout: options.timeoutMilliseconds,
      headersTimeout: options.timeoutMilliseconds,
      bodyTimeout: options.timeoutMilliseconds,
      maxResponseSize: options.maxResponseBytes,
    })
  }

  public async openStream(input: {
    readonly headers: Readonly<Record<string, string | undefined>>
    readonly method: PublicHttpMethod
    readonly pathAndQuery: string
    readonly signal: AbortSignal
    readonly worker: WorkerDescriptor
  }): Promise<PublicStreamingHttpResponse> {
    const controller = new AbortController()
    const signal = AbortSignal.any([input.signal, controller.signal])
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, this.timeoutMilliseconds)
    timeout.unref()
    let stream: Readable | undefined
    const cancel = () => {
      controller.abort()
      stream?.destroy()
    }
    this.streamCancels.add(cancel)
    try {
      const url = workerRestUrl(input.worker.origin, input.pathAndQuery)
      await this.verifier.assertCurrent(input.worker, signal)
      const response = await request(url, {
        dispatcher: this.dispatcher,
        headers: workerRequestHeaders(input.headers, this.identity),
        method: input.method,
        signal,
      })
      clearTimeout(timeout)
      await this.verifier.assertCurrent(input.worker, signal)
      stream = Readable.from(this.streamBody(response.body, input, signal, controller), {
        highWaterMark: this.maxResponseBytes,
        objectMode: false,
      })
      stream.on("error", () => undefined)
      const selectedStream = stream
      const closed = new Promise<void>((resolve) => selectedStream.once("close", () => {
        this.streamCancels.delete(cancel)
        resolve()
      }))
      return {
        body: selectedStream,
        cancel,
        closed,
        headers: workerResponseHeaders(response.headers),
        statusCode: response.statusCode,
        streaming: true,
      }
    } catch (error) {
      clearTimeout(timeout)
      this.streamCancels.delete(cancel)
      controller.abort()
      const normalized = error instanceof Error ? error : new Error("unknown stream open failure")
      throw normalizeStreamingTransportError(normalized, input.signal, timedOut)
    }
  }

  public async send(input: {
    readonly body?: Buffer
    readonly headers: Readonly<Record<string, string | undefined>>
    readonly method: PublicHttpMethod
    readonly pathAndQuery: string
    readonly signal: AbortSignal
    readonly worker: WorkerDescriptor
  }): Promise<UpstreamHttpResponse> {
    const timeoutSignal = AbortSignal.timeout(this.timeoutMilliseconds)
    const signal = AbortSignal.any([input.signal, timeoutSignal])
    try {
      if (input.body !== undefined && input.body.byteLength > this.maxRequestBytes) {
        throw new PublicRequestBodyTooLargeError()
      }
      const url = workerRestUrl(input.worker.origin, input.pathAndQuery)
      await this.verifier.assertCurrent(input.worker, signal)
      const requestOptions = {
        dispatcher: this.dispatcher,
        headers: workerRequestHeaders(input.headers, this.identity),
        method: input.method,
        signal,
      } as const
      const response = input.body === undefined
        ? await request(url, requestOptions)
        : await request(url, { ...requestOptions, body: input.body })
      const body = Buffer.from(await response.body.bytes())
      await this.verifier.assertCurrent(input.worker, signal)
      return {
        statusCode: response.statusCode,
        headers: workerResponseHeaders(response.headers),
        body,
      }
    } catch (error) {
      if (
        error instanceof WorkerRestBadResponseError ||
        error instanceof PublicRequestBodyTooLargeError
      ) throw error
      if (timeoutSignal.aborted && !input.signal.aborted) {
        throw new WorkerRestTimeoutError("worker request timed out", workerRestErrorOptions(error))
      }
      if (input.signal.aborted) {
        throw new WorkerRestAbortedError("public request was aborted", workerRestErrorOptions(error))
      }
      if (error instanceof WorkerIdentityMismatchError) throw error
      throw new WorkerRestBadResponseError(undefined, workerRestErrorOptions(error))
    }
  }

  public async close(): Promise<void> {
    for (const cancel of this.streamCancels) cancel()
    await this.dispatcher.close()
  }

  private async *streamBody(
    source: AsyncIterable<Uint8Array>,
    input: {
      readonly signal: AbortSignal
      readonly worker: WorkerDescriptor
    },
    signal: AbortSignal,
    controller: AbortController,
  ): AsyncGenerator<Buffer> {
    try {
      for await (const chunk of source) {
        const body = Buffer.from(chunk)
        if (body.byteLength > this.maxResponseBytes) throw new WorkerRestBadResponseError()
        await this.verifier.assertCurrent(input.worker, signal)
        yield body
      }
      await this.verifier.assertCurrent(input.worker, signal)
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error("unknown stream failure")
      throw normalizeStreamingTransportError(
        normalized,
        input.signal,
        isWorkerRestTimeoutError(normalized),
      )
    } finally {
      controller.abort()
    }
  }
}
