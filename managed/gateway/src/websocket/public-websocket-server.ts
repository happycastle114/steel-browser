import type { IncomingMessage } from "node:http"
import { WebSocketServer } from "ws"
import type { WorkerWebSocketHandshake } from "./worker-handshake.js"

export type PublicHandshakeMetadata = {
  readonly protocol: string
  readonly responseHeaders: WorkerWebSocketHandshake["responseHeaders"]
}

export function createPublicWebSocketServer(input: {
  readonly messageBytes: number
  readonly metadata: WeakMap<IncomingMessage, PublicHandshakeMetadata>
}): WebSocketServer {
  const server = new WebSocketServer({
    autoPong: false,
    clientTracking: false,
    handleProtocols: (protocols, request) => {
      const protocol = input.metadata.get(request)?.protocol
      return protocol !== undefined && protocol.length > 0 && protocols.has(protocol)
        ? protocol
        : false
    },
    maxPayload: input.messageBytes,
    noServer: true,
    perMessageDeflate: false,
  })
  server.on("headers", (headers, request) => {
    const metadata = input.metadata.get(request)
    if (metadata === undefined) return
    for (const [name, rawValue] of Object.entries(metadata.responseHeaders)) {
      const values = typeof rawValue === "string" ? [rawValue] : rawValue
      for (const value of values) headers.push(`${name}: ${value}`)
    }
  })
  return server
}
