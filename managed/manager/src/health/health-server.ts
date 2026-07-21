import { createServer, type Server } from "node:http"
import { once } from "node:events"
import type { RuntimeHealth } from "./runtime-health.js"

const HealthPath = {
  LIVE: "/livez",
  READY: "/readyz",
} as const
const HttpMethod = { GET: "GET" } as const
const HealthBody = { LIVE: "ok\n", NOT_READY: "not ready\n", READY: "ready\n" } as const

type HealthServerOptions = Readonly<{
  health: RuntimeHealth
  host?: string
  port?: number
}>

export type HealthServer = Readonly<{
  close(): Promise<void>
  listen(): Promise<void>
  server: Server
}>

export function createHealthServer(options: HealthServerOptions): HealthServer {
  const host = options.host ?? "127.0.0.1"
  const port = options.port ?? 3_001
  const server = createServer((request, response) => {
    response.setHeader("cache-control", "no-store")
    response.setHeader("content-type", "text/plain; charset=utf-8")
    if (request.method !== HttpMethod.GET) {
      response.setHeader("allow", HttpMethod.GET)
      response.writeHead(405).end()
      return
    }
    switch (request.url) {
      case HealthPath.LIVE:
        response.writeHead(200).end(HealthBody.LIVE)
        return
      case HealthPath.READY: {
        const ready = options.health.snapshot().ready
        response.writeHead(ready ? 200 : 503).end(ready ? HealthBody.READY : HealthBody.NOT_READY)
        return
      }
      default:
        response.writeHead(404).end()
    }
  })
  server.maxHeadersCount = 8
  server.headersTimeout = 2_000
  server.requestTimeout = 2_000
  server.keepAliveTimeout = 1_000
  return {
    server,
    async listen() {
      server.listen({ host, port })
      await once(server, "listening")
    },
    async close() {
      if (!server.listening) return
      server.close()
      await once(server, "close")
    },
  }
}
