import type { IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"
import WebSocket, { type WebSocketServer } from "ws"
import { ManagedWebSocketCapacityError } from "../api/public/error-mapper.js"
import type {
  WorkerGenerationVerifier,
  WorkerPrivateIdentity,
} from "../api/public/proxy.js"
import type { PublicRequestSecurity } from "../api/public/security.js"
import type { WorkerRegistry } from "../registry/worker-registry.js"
import {
  proxyWebSockets,
  type WebSocketDuplexController,
  type WebSocketReservationLedger,
  type WebSocketReservationLease,
} from "./duplex-proxy.js"
import { resolveWebSocketUpgrade } from "./upgrade-router.js"
import {
  bindIngressReservation,
  normalizedHeaders,
  normalizedUpgradeError,
  rejectUpgrade,
  type IngressConnectionReservation,
} from "./upgrade-response.js"
import {
  WorkerWebSocketConnectError,
  connectWorker,
  type WorkerWebSocketHandshake,
} from "./worker-handshake.js"
import {
  createPublicWebSocketServer,
  type PublicHandshakeMetadata,
} from "./public-websocket-server.js"
import {
  parseManagedWebSocketGatewayOptions,
  type ManagedWebSocketGatewayOptions,
} from "./upgrade-gateway-options.js"

export type { IngressConnectionReservation } from "./upgrade-response.js"
export { WorkerWebSocketConnectError } from "./worker-handshake.js"

export class ManagedWebSocketGateway {
  private readonly bufferBytes: number
  private readonly closeController = new AbortController()
  private readonly closeTimeoutMilliseconds: number
  private readonly controllers = new Set<WebSocketDuplexController>()
  private readonly identity: WorkerPrivateIdentity
  private readonly handshakeTimeoutMilliseconds: number
  private readonly ledger: WebSocketReservationLedger
  private readonly messageBytes: number
  private readonly metadata = new WeakMap<IncomingMessage, PublicHandshakeMetadata>()
  private readonly pending = new Set<Promise<void>>()
  private readonly registry: WorkerRegistry
  private readonly retryAfterSeconds: number
  private readonly security: PublicRequestSecurity
  private readonly verifier: WorkerGenerationVerifier
  private readonly webSocketServer: WebSocketServer
  private closed = false

  public constructor(input: ManagedWebSocketGatewayOptions) {
    const options = parseManagedWebSocketGatewayOptions(input)
    this.bufferBytes = options.bufferBytes
    this.closeTimeoutMilliseconds = options.closeTimeoutMilliseconds
    this.handshakeTimeoutMilliseconds = options.handshakeTimeoutMilliseconds
    this.identity = options.identity
    this.ledger = input.ledger
    this.messageBytes = options.messageBytes
    this.registry = input.registry
    this.retryAfterSeconds = options.retryAfterSeconds
    this.security = input.security
    this.verifier = input.verifier
    this.webSocketServer = createPublicWebSocketServer({
      messageBytes: options.messageBytes,
      metadata: this.metadata,
    })
  }

  public handle(input: {
    readonly connectionReservation: IngressConnectionReservation
    readonly head: Buffer
    readonly request: IncomingMessage
    readonly signal: AbortSignal
    readonly socket: Duplex
  }): Promise<void> {
    const task = this.handleUpgrade(input)
    this.pending.add(task)
    void task.then(
      () => this.pending.delete(task),
      () => this.pending.delete(task),
    )
    return task
  }

  public async close(): Promise<void> {
    this.closed = true
    this.closeController.abort()
    while (this.pending.size > 0) await Promise.allSettled([...this.pending])
    await Promise.all([...this.controllers].map(async (controller) => controller.shutdown()))
    this.controllers.clear()
  }

  private async handleUpgrade(input: {
    readonly connectionReservation: IngressConnectionReservation
    readonly head: Buffer
    readonly request: IncomingMessage
    readonly signal: AbortSignal
    readonly socket: Duplex
  }): Promise<void> {
    bindIngressReservation(input.socket, input.connectionReservation)
    const signal = AbortSignal.any([input.signal, this.closeController.signal])
    let handshake: WorkerWebSocketHandshake | undefined
    let reservation: WebSocketReservationLease | undefined
    let workerSocket: WebSocket | undefined
    try {
      if (this.closed || signal.aborted) {
        throw new WorkerWebSocketConnectError("websocket gateway is unavailable")
      }
      const headers = normalizedHeaders(input.request.headers)
      await this.security.authorize({ headers })
      const target = resolveWebSocketUpgrade({
        headers,
        pathAndQuery: input.request.url ?? "",
        registry: this.registry,
      })
      reservation = this.ledger.tryReserve()
      if (reservation === undefined) {
        throw new ManagedWebSocketCapacityError(this.retryAfterSeconds)
      }
      await this.verifier.assertCurrent(target.worker, signal)
      handshake = await connectWorker({
        headers,
        identity: this.identity,
        messageBytes: this.messageBytes,
        signal,
        target,
        timeoutMilliseconds: this.handshakeTimeoutMilliseconds,
      })
      workerSocket = handshake.socket
      await this.verifier.assertCurrent(target.worker, signal)
      await new Promise<void>((resolve) => setImmediate(resolve))
      if (signal.aborted) throw new WorkerWebSocketConnectError("websocket was aborted")
      handshake.assertOpen()
      this.metadata.set(input.request, handshake)
      const selectedReservation = reservation
      const selectedWorkerSocket = workerSocket
      let transferred = false
      this.webSocketServer.handleUpgrade(input.request, input.socket, input.head, (publicSocket) => {
        const controller = proxyWebSockets({
          bufferBytes: this.bufferBytes,
          closeTimeoutMilliseconds: this.closeTimeoutMilliseconds,
          messageBytes: this.messageBytes,
          publicSocket,
          reservation: selectedReservation,
          workerSocket: selectedWorkerSocket,
        })
        handshake?.transferOwnership()
        this.controllers.add(controller)
        void controller.closed.then(() => this.controllers.delete(controller))
        transferred = true
      })
      this.metadata.delete(input.request)
      if (!transferred) throw new WorkerWebSocketConnectError("public websocket did not upgrade")
      reservation = undefined
      workerSocket = undefined
    } catch (error) {
      this.metadata.delete(input.request)
      workerSocket?.terminate()
      reservation?.release()
      const normalized = error instanceof Error
        ? normalizedUpgradeError(error)
        : new WorkerWebSocketConnectError("unknown websocket failure")
      await rejectUpgrade(input.socket, normalized)
    }
  }
}
