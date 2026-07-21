import WebSocket, { type RawData } from "ws"
import type { WebSocketReservationLease } from "./reservation-ledger.js"

export {
  WEB_SOCKET_FIXED_OVERHEAD_BYTES,
  WebSocketReservationLedger,
} from "./reservation-ledger.js"
export type {
  WebSocketReservationLease,
  WebSocketReservationSnapshot,
} from "./reservation-ledger.js"
const FRAME_ACCOUNTING_BYTES = 32

export type WebSocketDuplexController = {
  readonly closed: Promise<void>
  readonly shutdown: () => Promise<void>
}

export const WebSocketCloseCode = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  MESSAGE_TOO_BIG: 1009,
  INTERNAL_ERROR: 1011,
  SERVICE_RESTART: 1012,
} as const

type DuplexProxyInput = {
  readonly bufferBytes: number
  readonly closeTimeoutMilliseconds: number
  readonly messageBytes: number
  readonly publicSocket: WebSocket
  readonly reservation: WebSocketReservationLease
  readonly workerSocket: WebSocket
}

type Frame = {
  readonly accountedBytes: number
  readonly binary: boolean
  readonly bytes: Buffer
}

class DirectionalFrameQueue {
  private active = false
  private queuedBytes = 0
  private readonly frames: Frame[] = []
  private readonly maxQueuedFrames: number

  public constructor(
    private readonly source: WebSocket,
    private readonly target: WebSocket,
    private readonly messageBytes: number,
    private readonly bufferBytes: number,
    private readonly fail: (code: number, reason: string) => void,
  ) {
    this.maxQueuedFrames = Math.max(1, Math.floor(bufferBytes / FRAME_ACCOUNTING_BYTES))
  }

  public enqueue(data: RawData, binary: boolean): void {
    const bytes = rawDataBuffer(data)
    const accountedBytes = Math.max(bytes.byteLength, FRAME_ACCOUNTING_BYTES)
    if (
      bytes.byteLength > this.messageBytes ||
      this.queuedBytes + accountedBytes > this.bufferBytes ||
      this.frames.length >= this.maxQueuedFrames
    ) {
      this.fail(WebSocketCloseCode.MESSAGE_TOO_BIG, "websocket message exceeded capacity")
      return
    }
    this.frames.push({ accountedBytes, binary, bytes })
    this.queuedBytes += accountedBytes
    this.source.pause()
    this.pump()
  }

  private pump(): void {
    if (this.active) return
    const frame = this.frames[0]
    if (frame === undefined) {
      this.source.resume()
      return
    }
    if (this.target.readyState !== WebSocket.OPEN) {
      this.fail(WebSocketCloseCode.INTERNAL_ERROR, "websocket peer was unavailable")
      return
    }
    if (this.target.bufferedAmount + frame.bytes.byteLength > this.bufferBytes) {
      this.fail(WebSocketCloseCode.MESSAGE_TOO_BIG, "websocket buffer exceeded capacity")
      return
    }
    this.active = true
    try {
      this.target.send(frame.bytes, { binary: frame.binary }, (error) => {
        this.active = false
        if (error instanceof Error) {
          this.fail(WebSocketCloseCode.INTERNAL_ERROR, "websocket forwarding failed")
          return
        }
        this.frames.shift()
        this.queuedBytes -= frame.accountedBytes
        this.pump()
      })
    } catch {
      this.active = false
      this.fail(WebSocketCloseCode.INTERNAL_ERROR, "websocket forwarding failed")
    }
  }
}

export function proxyWebSockets(input: DuplexProxyInput): WebSocketDuplexController {
  let closing = false
  let publicClosed = false
  let workerClosed = false
  let closeTimer: NodeJS.Timeout | undefined
  let resolveClosed: (() => void) | undefined
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve
  })
  const completeIfClosed = () => {
    if (!publicClosed || !workerClosed) return
    if (closeTimer !== undefined) clearTimeout(closeTimer)
    input.reservation.release()
    resolveClosed?.()
  }
  const startClosing = () => {
    if (!closing) {
      closing = true
      closeTimer = setTimeout(() => {
        terminateIfActive(input.publicSocket)
        terminateIfActive(input.workerSocket)
      }, input.closeTimeoutMilliseconds)
      closeTimer.unref()
    }
  }
  const closeBoth = (code: number, reason: string) => {
    startClosing()
    closeIfOpen(input.publicSocket, code, reason)
    closeIfOpen(input.workerSocket, code, reason)
  }
  const publicToWorker = new DirectionalFrameQueue(
    input.publicSocket,
    input.workerSocket,
    input.messageBytes,
    input.bufferBytes,
    closeBoth,
  )
  const workerToPublic = new DirectionalFrameQueue(
    input.workerSocket,
    input.publicSocket,
    input.messageBytes,
    input.bufferBytes,
    closeBoth,
  )
  input.publicSocket.on("message", (data, binary) => publicToWorker.enqueue(data, binary))
  input.workerSocket.on("message", (data, binary) => workerToPublic.enqueue(data, binary))
  forwardControlFrames(input.publicSocket, input.workerSocket)
  forwardControlFrames(input.workerSocket, input.publicSocket)
  input.publicSocket.once("close", (code) => {
    publicClosed = true
    startClosing()
    if (code === 1006) terminateIfActive(input.workerSocket)
    else closeBoth(clientCloseCode(code), "")
    completeIfClosed()
  })
  input.workerSocket.once("close", (code) => {
    workerClosed = true
    closeBoth(workerCloseCode(code), workerCloseReason(code))
    completeIfClosed()
  })
  input.publicSocket.once("error", () => closeBoth(
    WebSocketCloseCode.INTERNAL_ERROR,
    "public websocket failed",
  ))
  input.workerSocket.once("error", () => closeBoth(
    WebSocketCloseCode.INTERNAL_ERROR,
    "worker websocket failed",
  ))
  return {
    closed,
    shutdown: async () => {
      closeBoth(WebSocketCloseCode.SERVICE_RESTART, "manager restarting")
      await closed
      await new Promise<void>((resolve) => setImmediate(resolve))
      await new Promise<void>((resolve) => setImmediate(resolve))
    },
  }
}

function rawDataBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  return Buffer.concat(data)
}

function forwardControlFrames(source: WebSocket, target: WebSocket): void {
  source.on("ping", (data) => {
    if (target.readyState === WebSocket.OPEN) target.ping(data)
  })
  source.on("pong", (data) => {
    if (target.readyState === WebSocket.OPEN) target.pong(data)
  })
}

function closeIfOpen(socket: WebSocket, code: number, reason: string): void {
  if (socket.readyState === WebSocket.OPEN) socket.close(code, reason.slice(0, 120))
}

function terminateIfActive(socket: WebSocket): void {
  if (socket.readyState !== WebSocket.CLOSED) socket.terminate()
}

function clientCloseCode(code: number): number {
  return validCloseCode(code) ? code : WebSocketCloseCode.NORMAL
}

function workerCloseCode(code: number): number {
  return code === WebSocketCloseCode.NORMAL
    ? WebSocketCloseCode.NORMAL
    : WebSocketCloseCode.INTERNAL_ERROR
}

function workerCloseReason(code: number): string {
  return code === WebSocketCloseCode.NORMAL ? "" : "worker websocket failed"
}

function validCloseCode(code: number): boolean {
  return (
    code === WebSocketCloseCode.NORMAL ||
    code === WebSocketCloseCode.GOING_AWAY ||
    (code >= 1002 && code <= 1003) ||
    (code >= 1007 && code <= 1014) ||
    (code >= 3000 && code <= 4999)
  )
}
