import WebSocket, { type RawData } from "ws"
import { z } from "zod"
import { ManagedTransportError } from "@happycastle/steel-managed-gateway"
import { MANAGED_ERROR_CODE } from "@happycastle/steel-managed-shared"

const CdpResponseSchema = z.object({
  id: z.number().int().positive(),
  result: z.unknown().optional(),
  error: z.object({
    code: z.number().int(),
    message: z.string(),
  }).strict().optional(),
}).passthrough()

const CONNECTION_STATE = {
  OPEN: "OPEN",
  CLOSED: "CLOSED",
} as const
type ConnectionState = (typeof CONNECTION_STATE)[keyof typeof CONNECTION_STATE]

type PendingCommand = Readonly<{
  reject(error: Error): void
  resolve(value: unknown): void
  timeout: NodeJS.Timeout
}>

type CdpConnectionOptions = Readonly<{
  commandTimeoutMilliseconds: number
  messageBytes: number
  signal: AbortSignal
  socket: WebSocket
}>

export interface CdpCommandPort {
  close(): Promise<void>
  send(
    method: string,
    params?: Readonly<Record<string, unknown>>,
    sessionId?: string,
  ): Promise<unknown>
}

export class CdpConnection implements CdpCommandPort {
  private readonly pending = new Map<number, PendingCommand>()
  private readonly signal: AbortSignal
  private readonly socket: WebSocket
  private readonly timeoutMilliseconds: number
  private readonly messageBytes: number
  private nextId = 1
  private state: ConnectionState = CONNECTION_STATE.OPEN

  public constructor(options: CdpConnectionOptions) {
    if (!Number.isSafeInteger(options.commandTimeoutMilliseconds) || options.commandTimeoutMilliseconds < 1) {
      throw new RangeError("CDP command timeout must be positive")
    }
    if (!Number.isSafeInteger(options.messageBytes) || options.messageBytes < 1) {
      throw new RangeError("CDP message limit must be positive")
    }
    if (options.socket.readyState !== WebSocket.OPEN) throw cdpFailure("CDP socket is not open")
    this.messageBytes = options.messageBytes
    this.signal = options.signal
    this.socket = options.socket
    this.timeoutMilliseconds = options.commandTimeoutMilliseconds
    this.socket.on("message", this.receive)
    this.socket.once("close", this.closed)
    this.socket.once("error", this.failed)
    this.signal.addEventListener("abort", this.aborted, { once: true })
  }

  public async send(
    method: string,
    params: Readonly<Record<string, unknown>> = {},
    sessionId?: string,
  ): Promise<unknown> {
    if (method.length === 0) throw new RangeError("CDP method is required")
    if (this.signal.aborted) throw cdpTimeout("CDP command was aborted")
    if (this.state !== CONNECTION_STATE.OPEN || this.socket.readyState !== WebSocket.OPEN) {
      throw cdpFailure("CDP socket is unavailable")
    }
    const id = this.nextId
    this.nextId += 1
    const request = JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) })
    if (Buffer.byteLength(request) > this.messageBytes) throw cdpFailure("CDP command exceeded capacity")
    return await new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(cdpTimeout("CDP command timed out"))
      }, this.timeoutMilliseconds)
      timeout.unref()
      this.pending.set(id, { reject, resolve, timeout })
      this.socket.send(request, (error) => {
        if (!(error instanceof Error)) return
        const pending = this.pending.get(id)
        if (pending === undefined) return
        this.pending.delete(id)
        clearTimeout(pending.timeout)
        pending.reject(cdpFailure("CDP command could not be sent"))
      })
    })
  }

  public async close(): Promise<void> {
    if (this.state === CONNECTION_STATE.CLOSED) return
    this.terminate(cdpFailure("CDP connection closed"))
    if (this.socket.readyState === WebSocket.CLOSED) return
    await new Promise<void>((resolve) => {
      this.socket.once("close", () => resolve())
      this.socket.close(WebSocketCloseCode.NORMAL)
      const timeout = setTimeout(() => {
        this.socket.terminate()
        resolve()
      }, 250)
      timeout.unref()
    })
  }

  private readonly receive = (raw: RawData, binary: boolean): void => {
    if (binary) return this.terminate(cdpFailure("CDP returned a binary message"))
    const bytes = rawBytes(raw)
    if (bytes.byteLength > this.messageBytes) return this.terminate(cdpFailure("CDP response exceeded capacity"))
    let parsed: unknown
    try {
      parsed = JSON.parse(bytes.toString("utf8"))
    } catch {
      return this.terminate(cdpFailure("CDP returned invalid JSON"))
    }
    const response = CdpResponseSchema.safeParse(parsed)
    if (!response.success) return
    const pending = this.pending.get(response.data.id)
    if (pending === undefined) return
    this.pending.delete(response.data.id)
    clearTimeout(pending.timeout)
    if (response.data.error !== undefined) {
      pending.reject(cdpFailure(`CDP command failed (${response.data.error.code})`))
      return
    }
    pending.resolve(response.data.result)
  }

  private readonly aborted = (): void => this.terminate(cdpTimeout("CDP command was aborted"))
  private readonly closed = (): void => this.terminate(cdpFailure("CDP socket closed"))
  private readonly failed = (_error: Error): void => this.terminate(cdpFailure("CDP socket failed"))

  private terminate(error: Error): void {
    if (this.state === CONNECTION_STATE.CLOSED) return
    this.state = CONNECTION_STATE.CLOSED
    this.signal.removeEventListener("abort", this.aborted)
    this.socket.off("message", this.receive)
    this.socket.off("close", this.closed)
    this.socket.off("error", this.failed)
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

const WebSocketCloseCode = { NORMAL: 1_000 } as const

function rawBytes(raw: RawData): Buffer {
  if (Buffer.isBuffer(raw)) return raw
  if (raw instanceof ArrayBuffer) return Buffer.from(raw)
  if (Array.isArray(raw)) return Buffer.concat(raw)
  throw new TypeError("CDP message representation is unsupported")
}

function cdpFailure(message: string): ManagedTransportError {
  return new ManagedTransportError(MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE, message)
}

function cdpTimeout(message: string): ManagedTransportError {
  return new ManagedTransportError(MANAGED_ERROR_CODE.TOOL_TIMEOUT, message)
}
