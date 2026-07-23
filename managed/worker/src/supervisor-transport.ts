import {
  request as createUpstreamRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from "node:http"
import type { AddressInfo } from "node:net"
import type { Duplex } from "node:stream"
import {
  WORKER_IDENTITY_HEADER,
  type WorkerId,
} from "./config.js"

const INTERNAL_HEADER_PREFIX = ["x-managed-", "x-steel-managed-"] as const
const UPSTREAM_AUTHORITY_HEADER = "host"
const PROXY_ERROR_STATUS = 502

type SupervisorUpgradeConnection = {
  readonly head: Buffer
  readonly incoming: IncomingMessage
  readonly socket: Duplex
}

export type SupervisorProxyConfig = {
  readonly browserVersion: string
  readonly instanceId: string
  readonly upstreamSha: string
  readonly upstream: Pick<AddressInfo, "address" | "port">
  readonly workerId: WorkerId
}

export type SupervisorTransport = {
  readonly proxyHttp: (
    incoming: IncomingMessage,
    response: ServerResponse,
  ) => void
  readonly proxyUpgrade: (
    incoming: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => void
}

export function supervisorIdentityHeaders(
  config: SupervisorProxyConfig,
): OutgoingHttpHeaders {
  return {
    [WORKER_IDENTITY_HEADER.INSTANCE_ID]: config.instanceId,
    [WORKER_IDENTITY_HEADER.WORKER_ID]: config.workerId,
  }
}

function isInternalHeader(name: string): boolean {
  const normalized = name.toLowerCase()
  return INTERNAL_HEADER_PREFIX.some((prefix) => normalized.startsWith(prefix))
}

export function sanitizeProxyHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const sanitized: OutgoingHttpHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    if (
      name.toLowerCase() !== UPSTREAM_AUTHORITY_HEADER &&
      !isInternalHeader(name) &&
      value !== undefined
    ) {
      sanitized[name] = value
    }
  }
  return sanitized
}

function sendProxyFailure(
  response: ServerResponse,
  config: SupervisorProxyConfig,
): void {
  if (response.headersSent) {
    response.destroy()
    return
  }
  const body = Buffer.from(JSON.stringify({ code: "WORKER_UPSTREAM_UNAVAILABLE" }))
  response.writeHead(PROXY_ERROR_STATUS, {
    ...supervisorIdentityHeaders(config),
    "content-length": String(body.byteLength),
    "content-type": "application/json; charset=utf-8",
  })
  response.end(body)
}

function proxySupervisorHttp(
  incoming: IncomingMessage,
  response: ServerResponse,
  config: SupervisorProxyConfig,
): void {
  const outgoing = createUpstreamRequest(
    {
      headers: sanitizeProxyHeaders(incoming.headers),
      host: config.upstream.address,
      method: incoming.method,
      path: incoming.url,
      port: config.upstream.port,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? PROXY_ERROR_STATUS, {
        ...sanitizeProxyHeaders(upstreamResponse.headers),
        ...supervisorIdentityHeaders(config),
      })
      upstreamResponse.pipe(response)
    },
  )
  outgoing.on("error", () => sendProxyFailure(response, config))
  incoming.on("aborted", () => outgoing.destroy())
  incoming.pipe(outgoing)
}

function sanitizedRawHeaders(headers: readonly string[]): readonly string[] {
  const sanitized: string[] = []
  for (let index = 0; index < headers.length; index += 2) {
    const name = headers[index]
    const value = headers[index + 1]
    if (name !== undefined && value !== undefined && !isInternalHeader(name)) {
      sanitized.push(name, value)
    }
  }
  return sanitized
}

function writeUpgradeResponse(
  socket: Duplex,
  response: IncomingMessage,
  config: SupervisorProxyConfig,
): void {
  const statusCode = response.statusCode ?? PROXY_ERROR_STATUS
  const statusMessage = response.statusMessage ?? "Bad Gateway"
  const trustedIdentity = supervisorIdentityHeaders(config)
  const headers = [
    ...sanitizedRawHeaders(response.rawHeaders),
    ...Object.entries(trustedIdentity).flatMap(([name, value]) =>
      value === undefined ? [] : [name, String(value)],
    ),
  ]
  const headerLines: string[] = [`HTTP/1.1 ${statusCode} ${statusMessage}`]
  for (let index = 0; index < headers.length; index += 2) {
    const name = headers[index]
    const value = headers[index + 1]
    if (name !== undefined && value !== undefined) {
      headerLines.push(`${name}: ${value}`)
    }
  }
  socket.write(`${headerLines.join("\r\n")}\r\n\r\n`)
}

function proxySupervisorUpgrade(
  connection: SupervisorUpgradeConnection,
  config: SupervisorProxyConfig,
): void {
  const { head, incoming, socket } = connection
  socket.pause()
  const outgoing = createUpstreamRequest({
    headers: sanitizeProxyHeaders(incoming.headers),
    host: config.upstream.address,
    method: incoming.method,
    path: incoming.url,
    port: config.upstream.port,
  })
  outgoing.on("upgrade", (response, upstreamSocket, upstreamHead) => {
    writeUpgradeResponse(socket, response, config)
    if (upstreamHead.byteLength > 0) {
      socket.write(upstreamHead)
    }
    if (head.byteLength > 0) {
      upstreamSocket.write(head)
    }
    upstreamSocket.pipe(socket)
    socket.pipe(upstreamSocket)
    upstreamSocket.on("error", () => socket.destroy())
    socket.resume()
  })
  outgoing.on("response", (response) => {
    writeUpgradeResponse(socket, response, config)
    response.pipe(socket)
    socket.resume()
  })
  outgoing.on("error", () => socket.destroy())
  socket.on("error", () => outgoing.destroy())
  outgoing.end()
}

export function createSupervisorTransport(
  config: SupervisorProxyConfig,
): SupervisorTransport {
  return {
    proxyHttp: (incoming, response) => {
      proxySupervisorHttp(incoming, response, config)
    },
    proxyUpgrade: (incoming, socket, head) => {
      proxySupervisorUpgrade({ head, incoming, socket }, config)
    },
  }
}
