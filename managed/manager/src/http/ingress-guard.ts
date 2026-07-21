import type { IncomingMessage, Server, ServerResponse } from "node:http"
import type { Socket } from "node:net"
import type { Duplex } from "node:stream"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import {
  AtomicReservationLedger,
  ReservationCapacityError,
  type ReservationLease,
} from "../memory/atomic-reservation-ledger.js"

const ContentEncoding = { IDENTITY: "identity" } as const

export class BodyTooLargeError extends Error {
  public override readonly name = "BodyTooLargeError"
}

export class UnsupportedContentEncodingError extends Error {
  public override readonly name = "UnsupportedContentEncodingError"
}

type ConnectionGuardOptions = Readonly<{
  ledger: AtomicReservationLedger
  onRejected: () => void
  reservationBytes: number
}>

export type ConnectionReservationRegistry = Readonly<{
  require(socket: Duplex): ReservationLease
}>

type BodyGuardOptions = Readonly<{
  bodyLimitBytes: number
  bodyTimeoutMilliseconds: number
  ledger: AtomicReservationLedger
  reservationBytes: number
}>

export function installConnectionGuard(
  server: Server,
  options: ConnectionGuardOptions,
): ConnectionReservationRegistry {
  const leases = new WeakMap<Duplex, ReservationLease>()
  server.maxConnections = options.ledger.snapshot().limitCount
  server.on("drop", options.onRejected)
  server.prependListener("connection", (socket: Socket) => {
    let lease: ReservationLease
    try {
      lease = options.ledger.reserve(options.reservationBytes)
    } catch (error) {
      if (!(error instanceof ReservationCapacityError)) throw error
      options.onRejected()
      socket.destroy()
      return
    }
    leases.set(socket, lease)
    socket.once("close", () => {
      lease.release()
      leases.delete(socket)
    })
  })
  return {
    require(socket) {
      const lease = leases.get(socket)
      if (lease === undefined) throw new TypeError("ingress connection reservation missing")
      return lease
    },
  }
}

export function installIngressBodyGuard(
  app: FastifyInstance,
  options: BodyGuardOptions,
): void {
  app.addHook("preParsing", async (request, reply, payload) => {
    requireSupportedEncoding(request)
    const bodySize = declaredBodySize(request)
    if (bodySize !== undefined && bodySize > options.bodyLimitBytes) {
      throw new BodyTooLargeError()
    }
    if (bodySize === 0 || (bodySize === undefined && !hasChunkedBody(request))) return payload
    const lease = options.ledger.reserve(options.reservationBytes)
    holdBodyReservation(request, reply, lease, options.bodyTimeoutMilliseconds)
    return payload
  })
}

function requireSupportedEncoding(request: FastifyRequest): void {
  const encoding = request.headers["content-encoding"]
  if (
    encoding !== undefined &&
    (typeof encoding !== "string" || encoding.toLowerCase() !== ContentEncoding.IDENTITY)
  ) {
    throw new UnsupportedContentEncodingError()
  }
}

function declaredBodySize(request: FastifyRequest): number | undefined {
  const header = request.headers["content-length"]
  if (header === undefined) return undefined
  if (typeof header !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(header)) {
    throw new BodyTooLargeError()
  }
  const parsed = Number(header)
  if (!Number.isSafeInteger(parsed)) throw new BodyTooLargeError()
  return parsed
}

function hasChunkedBody(request: FastifyRequest): boolean {
  return request.headers["transfer-encoding"] === "chunked"
}

function holdBodyReservation(
  request: FastifyRequest,
  reply: FastifyReply,
  lease: ReservationLease,
  timeoutMilliseconds: number,
): void {
  const bodyTimer = setTimeout(() => request.raw.destroy(), timeoutMilliseconds)
  bodyTimer.unref()
  const clearBodyTimer = () => clearTimeout(bodyTimer)
  request.raw.once("end", clearBodyTimer)
  request.raw.once("aborted", clearBodyTimer)
  const release = () => {
    if (!lease.release()) return
    clearBodyTimer()
    detachReleaseListeners(request.raw, reply.raw, release)
  }
  request.raw.once("aborted", release)
  request.raw.socket.once("close", release)
  reply.raw.once("close", release)
  reply.raw.once("finish", release)
}

function detachReleaseListeners(
  request: IncomingMessage,
  response: ServerResponse,
  release: () => void,
): void {
  request.off("aborted", release)
  request.socket.off("close", release)
  response.off("close", release)
  response.off("finish", release)
}
