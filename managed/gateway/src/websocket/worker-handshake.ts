import type { IncomingHttpHeaders, IncomingMessage } from "node:http"
import WebSocket from "ws"
import { InvalidArgumentError } from "../api/public/error-mapper.js"
import {
  isManagedInternalHeader,
  workerRequestHeaders,
} from "../api/public/proxy-headers.js"
import type { WorkerPrivateIdentity } from "../api/public/proxy.js"
import type { WebSocketUpgradeTarget } from "./upgrade-router.js"
import { containsPrivateAuthority } from "../api/public/response-safety.js"

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u
const UNSAFE_UPGRADE_HEADERS = new Set([
  "authorization",
  "connection",
  "content-length",
  "cookie",
  "proxy-authenticate",
  "sec-websocket-accept",
  "sec-websocket-extensions",
  "sec-websocket-protocol",
  "set-cookie",
  "transfer-encoding",
  "upgrade",
  "www-authenticate",
])

export class WorkerWebSocketConnectError extends Error {
  public override readonly name = "WorkerWebSocketConnectError"
}

export type WorkerWebSocketHandshake = {
  readonly assertOpen: () => void
  readonly protocol: string
  readonly responseHeaders: Readonly<Record<string, string | readonly string[]>>
  readonly socket: WebSocket
  readonly transferOwnership: () => void
}

const HandshakeState = {
  CONNECTING: "CONNECTING",
  OPEN: "OPEN",
  TERMINAL: "TERMINAL",
  TRANSFERRED: "TRANSFERRED",
} as const
type HandshakeState = (typeof HandshakeState)[keyof typeof HandshakeState]

export async function connectWorker(input: {
  readonly headers: Readonly<Record<string, string | undefined>>
  readonly identity: WorkerPrivateIdentity
  readonly messageBytes: number
  readonly signal: AbortSignal
  readonly target: WebSocketUpgradeTarget
  readonly timeoutMilliseconds: number
}): Promise<WorkerWebSocketHandshake> {
  if (input.signal.aborted) throw new WorkerWebSocketConnectError("worker websocket was aborted")
  const protocols = requestedProtocols(input.headers["sec-websocket-protocol"])
  const url = new URL(input.target.upstreamPathAndQuery, input.target.worker.origin)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  let socket: WebSocket
  try {
    socket = new WebSocket(url, protocols, {
      autoPong: false,
      headers: workerRequestHeaders(input.headers, input.identity),
      maxPayload: input.messageBytes,
      perMessageDeflate: false,
    })
  } catch (error) {
    throw new WorkerWebSocketConnectError("worker websocket refused", errorOptions(error))
  }
  return awaitWorkerOpen({
    signal: input.signal,
    socket,
    timeoutMilliseconds: input.timeoutMilliseconds,
    workerOrigin: input.target.worker.origin,
  })
}

function awaitWorkerOpen(input: {
  readonly signal: AbortSignal
  readonly socket: WebSocket
  readonly timeoutMilliseconds: number
  readonly workerOrigin: string
}): Promise<WorkerWebSocketHandshake> {
  return new Promise((resolve, reject) => {
    let state: HandshakeState = HandshakeState.CONNECTING
    let responseHeaders: IncomingHttpHeaders = {}
    const upgrade = (response: IncomingMessage) => {
      responseHeaders = response.headers
    }
    const clearConnectObservers = () => {
      clearTimeout(timeout)
      input.socket.off("open", open)
      input.socket.off("unexpected-response", unexpectedResponse)
      input.socket.off("upgrade", upgrade)
    }
    const cleanup = () => {
      clearConnectObservers()
      input.socket.off("close", closed)
      input.socket.off("error", failed)
      input.signal.removeEventListener("abort", aborted)
    }
    const terminal = (error?: Error) => {
      if (state === HandshakeState.TERMINAL) return
      const previousState = state
      state = HandshakeState.TERMINAL
      clearConnectObservers()
      input.signal.removeEventListener("abort", aborted)
      if (input.socket.readyState !== WebSocket.CLOSED) input.socket.terminate()
      if (previousState === HandshakeState.CONNECTING) {
        reject(new WorkerWebSocketConnectError("worker websocket refused", errorOptions(error)))
      }
    }
    const aborted = () => terminal()
    const failed = (error: Error) => terminal(error)
    const unexpectedResponse = () => terminal()
    const closed = () => {
      terminal()
      cleanup()
    }
    const open = () => {
      if (state !== HandshakeState.CONNECTING) return
      state = HandshakeState.OPEN
      clearConnectObservers()
      resolve({
        assertOpen: () => {
          if (state !== HandshakeState.OPEN || input.socket.readyState !== WebSocket.OPEN) {
            throw new WorkerWebSocketConnectError("worker websocket closed before transfer")
          }
        },
        protocol: input.socket.protocol,
        responseHeaders: safeUpgradeHeaders(responseHeaders, input.workerOrigin),
        socket: input.socket,
        transferOwnership: () => {
          if (state !== HandshakeState.OPEN || input.socket.readyState !== WebSocket.OPEN) {
            throw new WorkerWebSocketConnectError("worker websocket closed before transfer")
          }
          state = HandshakeState.TRANSFERRED
          input.signal.removeEventListener("abort", aborted)
        },
      })
    }
    const timeout = setTimeout(terminal, input.timeoutMilliseconds)
    timeout.unref()
    input.socket.on("error", failed)
    input.socket.once("close", closed)
    input.socket.once("open", open)
    input.socket.once("unexpected-response", unexpectedResponse)
    input.socket.once("upgrade", upgrade)
    input.signal.addEventListener("abort", aborted, { once: true })
  })
}

function requestedProtocols(value: string | undefined): string[] {
  if (value === undefined) return []
  const protocols = value.split(",").map((protocol) => protocol.trim())
  if (
    protocols.some((protocol) => !TOKEN.test(protocol)) ||
    new Set(protocols).size !== protocols.length
  ) {
    throw new InvalidArgumentError("websocket subprotocol is invalid")
  }
  return protocols
}

function safeUpgradeHeaders(
  headers: IncomingHttpHeaders,
  workerOrigin: string,
): Readonly<Record<string, string | readonly string[]>> {
  const privateUrl = new URL(workerOrigin)
  return Object.fromEntries(Object.entries(headers).flatMap(([rawName, value]) => {
    const name = rawName.toLowerCase()
    if (
      value === undefined ||
      UNSAFE_UPGRADE_HEADERS.has(name) ||
      isManagedInternalHeader(name)
    ) return []
    const values = typeof value === "string" ? [value] : value
    if (values.some((item) => containsPrivateAuthority(item, privateUrl))) return []
    return [[name, value] as const]
  }))
}

function errorOptions(error: unknown): ErrorOptions | undefined {
  return error instanceof Error ? { cause: error } : undefined
}
