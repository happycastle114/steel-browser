import type { IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"
import type { FastifyInstance } from "fastify"
import type { ManagerConfig } from "../config.js"
import type { RuntimeHealth } from "../health/runtime-health.js"
import type { HealthServer } from "../health/health-server.js"
import {
  buildPublicServerRuntime,
  type PublicServerOptions,
} from "../http/public-server.js"
import {
  RequestBoundaryError,
  RequestBoundaryFailure,
} from "../http/request-security.js"
import { AuthenticationError } from "../auth/authentication-error.js"

export type RuntimeWebSocketPort = Readonly<{
  close(): Promise<void>
  handle(input: Readonly<{
    connectionReservation: Readonly<{ release(): boolean }>
    head: Buffer
    request: IncomingMessage
    signal: AbortSignal
    socket: Duplex
  }>): Promise<void>
}>

export type RuntimeReconciliationPort = Readonly<{
  runNow(): Promise<void>
  start(): void
  stop(): Promise<void>
}>

export type ManagerRuntimePorts = Readonly<{
  closeDependencies(): Promise<void>
  drain(): Promise<void>
  reconciliation: RuntimeReconciliationPort
  registerRoutes(app: FastifyInstance): Promise<void> | void
  webSocket: RuntimeWebSocketPort
}>

export type ManagerRuntimeOptions = Readonly<{
  config: ManagerConfig
  health: RuntimeHealth
  healthServer: HealthServer
  onError?: (error: unknown) => void
  ports: ManagerRuntimePorts
  publicHost: string
  publicPort: number
  publicServer: Omit<PublicServerOptions, "registerRoutes">
  shutdownTimeoutMilliseconds: number
}>

const UpgradeStatus = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  HOST_REJECTED: 421,
  INTERNAL: 500,
} as const

export class ManagerRuntime {
  private readonly app: FastifyInstance
  private readonly closeController = new AbortController()
  private readonly connectionReservations: ReturnType<
    typeof buildPublicServerRuntime
  >["connectionReservations"]
  private closePromise: Promise<void> | undefined
  private started = false

  public constructor(private readonly options: ManagerRuntimeOptions) {
    assertManagerRuntimePorts(options.ports)
    if (
      !Number.isSafeInteger(options.shutdownTimeoutMilliseconds) ||
      options.shutdownTimeoutMilliseconds < 1
    ) {
      throw new RangeError("shutdown timeout must be positive")
    }
    const publicRuntime = buildPublicServerRuntime({
      ...options.publicServer,
      registerRoutes: (app) => options.ports.registerRoutes(app),
    })
    this.app = publicRuntime.app
    this.connectionReservations = publicRuntime.connectionReservations
    this.app.server.on("upgrade", (request, socket, head) => {
      void this.handleUpgrade(request, socket, head)
    })
  }

  public publicServer(): FastifyInstance {
    return this.app
  }

  public async start(): Promise<void> {
    if (this.started) throw new TypeError("manager runtime already started")
    await this.app.ready()
    try {
      await this.options.healthServer.listen()
      await this.app.listen({
        host: this.options.publicHost,
        port: this.options.publicPort,
      })
    } catch (error) {
      await Promise.allSettled([this.app.close(), this.options.healthServer.close()])
      throw error
    }
    this.started = true
    this.options.health.markInitialized()
    try {
      await this.options.ports.reconciliation.runNow()
      this.options.ports.reconciliation.start()
    } catch (error) {
      await this.close()
      throw error
    }
  }

  public close(): Promise<void> {
    this.closePromise ??= this.closeOnce()
    return this.closePromise
  }

  private async closeOnce(): Promise<void> {
    const deadline = Date.now() + this.options.shutdownTimeoutMilliseconds
    this.options.health.markStopping()
    this.closeController.abort()
    await settleWithin(
      this.runShutdownOperation(() => this.options.ports.drain()),
      remainingMilliseconds(deadline),
    )
    await settleWithin(
      this.runShutdownOperation(() => this.options.ports.reconciliation.stop()),
      remainingMilliseconds(deadline),
    )
    const closing = Promise.allSettled([
      this.runShutdownOperation(() => this.options.ports.webSocket.close()),
      this.runShutdownOperation(() => this.app.close()),
      this.runShutdownOperation(() => this.options.ports.closeDependencies()),
    ]).then(() => undefined)
    const completed = await settleWithin(
      closing,
      remainingMilliseconds(deadline),
    )
    if (!completed) {
      this.app.server.closeAllConnections()
      this.app.server.close()
    }
    const healthClosed = await settleWithin(
      this.runShutdownOperation(() => this.options.healthServer.close()),
      remainingMilliseconds(deadline),
    )
    if (!healthClosed) {
      this.options.healthServer.server.closeAllConnections()
      this.options.healthServer.server.close()
    }
  }

  private async handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    try {
      await this.options.publicServer.requestSecurity.authorize(request.headers)
      const connectionReservation = this.connectionReservations.require(socket)
      await this.options.ports.webSocket.handle({
        connectionReservation,
        head,
        request,
        signal: this.closeController.signal,
        socket,
      })
    } catch (error) {
      rejectUpgrade(socket, upgradeStatus(error))
    }
  }

  private async runShutdownOperation(operation: () => Promise<void>): Promise<void> {
    try {
      await operation()
    } catch (error) {
      this.reportError(error)
    }
  }

  private reportError(error: unknown): void {
    try {
      this.options.onError?.(error)
    } catch {
      return
    }
  }
}

export function assertManagerRuntimePorts(ports: unknown): asserts ports is ManagerRuntimePorts {
  if (typeof ports !== "object" || ports === null) {
    throw new TypeError("required manager runtime port missing")
  }
  const reconciliation = Reflect.get(ports, "reconciliation")
  const webSocket = Reflect.get(ports, "webSocket")
  if (
    typeof reconciliation !== "object" ||
    reconciliation === null ||
    typeof webSocket !== "object" ||
    webSocket === null
  ) {
    throw new TypeError("required manager runtime port missing")
  }
  const functions = [
    Reflect.get(ports, "closeDependencies"),
    Reflect.get(ports, "drain"),
    Reflect.get(reconciliation, "runNow"),
    Reflect.get(reconciliation, "start"),
    Reflect.get(reconciliation, "stop"),
    Reflect.get(ports, "registerRoutes"),
    Reflect.get(webSocket, "close"),
    Reflect.get(webSocket, "handle"),
  ]
  if (functions.some((value) => typeof value !== "function")) {
    throw new TypeError("required manager runtime port missing")
  }
}

function upgradeStatus(error: unknown): number {
  if (error instanceof AuthenticationError) return UpgradeStatus.AUTH_REQUIRED
  if (error instanceof RequestBoundaryError) {
    return error.code === RequestBoundaryFailure.HOST_REJECTED
      ? UpgradeStatus.HOST_REJECTED
      : UpgradeStatus.FORBIDDEN
  }
  return UpgradeStatus.INTERNAL
}

function rejectUpgrade(socket: Duplex, status: number): void {
  if (socket.destroyed) return
  socket.end(
    `HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  )
}

async function settleWithin(promise: Promise<void>, timeoutMilliseconds: number): Promise<boolean> {
  if (timeoutMilliseconds <= 0) return false
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMilliseconds)
    timer.unref()
  })
  const completed = await Promise.race([promise.then(() => true as const), timeout])
  if (timer !== undefined) clearTimeout(timer)
  return completed
}

function remainingMilliseconds(deadline: number): number {
  return Math.max(0, deadline - Date.now())
}
