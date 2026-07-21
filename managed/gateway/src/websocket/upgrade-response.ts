import { STATUS_CODES, type IncomingHttpHeaders } from "node:http"
import type { Duplex } from "node:stream"
import { z } from "zod"
import {
  InvalidArgumentError,
  RouteNotFoundError,
  mapPublicError,
} from "../api/public/error-mapper.js"
import {
  InvalidWebSocketQueryError,
  WebSocketRouteNotFoundError,
} from "./upgrade-router.js"

export type IngressConnectionReservation = { readonly release: () => boolean }

export function bindIngressReservation(
  socket: Duplex,
  reservation: IngressConnectionReservation,
): void {
  let released = false
  const release = () => {
    if (released) return
    released = true
    reservation.release()
  }
  socket.once("close", release)
  if (socket.destroyed) queueMicrotask(release)
}

export function normalizedHeaders(
  headers: IncomingHttpHeaders,
): Readonly<Record<string, string | undefined>> {
  const normalized: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) throw new InvalidArgumentError("duplicate header")
    normalized[name.toLowerCase()] = value
  }
  return normalized
}

export function normalizedUpgradeError(error: unknown): unknown {
  if (error instanceof WebSocketRouteNotFoundError) return new RouteNotFoundError()
  if (error instanceof InvalidWebSocketQueryError || error instanceof z.ZodError) {
    return new InvalidArgumentError()
  }
  return error
}

export async function rejectUpgrade(socket: Duplex, error: unknown): Promise<void> {
  if (socket.destroyed) return
  const response = mapPublicError(error, crypto.randomUUID())
  const statusMessage = STATUS_CODES[response.statusCode] ?? "Error"
  const headers = {
    ...response.headers,
    connection: "close",
    "content-length": String(response.body.byteLength),
  }
  const lines = Object.entries(headers).flatMap(([name, value]) =>
    value === undefined
      ? []
      : [`${name}: ${Array.isArray(value) ? value.join(", ") : value}`],
  )
  const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()))
  socket.end(Buffer.concat([
    Buffer.from(`HTTP/1.1 ${response.statusCode} ${statusMessage}\r\n${lines.join("\r\n")}\r\n\r\n`),
    response.body,
  ]), () => socket.destroy())
  await closed
}
