import { randomUUID } from "node:crypto"
import {
  ManagedWebSocketGateway,
  PoolMutationCoordinator,
  PublicRestGateway,
  WorkerRestProxy,
  registerManagedOperationsApi,
  type ManagedAiTransportPlugin,
  type ManagedEventJournal,
  type ManagedListSnapshotStore,
  type PublicRequestSecurity,
  type WebSocketReservationLedger,
} from "@happycastle/steel-managed-gateway"
import {
  CONTROL_PLANE_FIXED,
  SessionIdSchema,
  UuidSchema,
} from "@happycastle/steel-managed-shared"
import type { RuntimeHealth } from "../health/runtime-health.js"
import { createHealthServer } from "../health/health-server.js"
import { ManagerCompatibilityLifecycle } from "../http/compatibility-lifecycle.js"
import type { AuthorizedRequestContextStore } from "../http/request-context-store.js"
import { registerPublicRestBridge } from "../http/public-rest-bridge.js"
import type { RequestSecurity } from "../http/request-security.js"
import type { AtomicReservationLedger } from "../memory/atomic-reservation-ledger.js"
import type { ManagedAdmissionCoordinator } from "../operations/admission-coordinator.js"
import type { ManagedCreateHeaders } from "../operations/managed-create-headers.js"
import type { ManagerOperationsPort } from "../operations/manager-operations-port.js"
import type { ManagerPoolController } from "../operations/pool-controller.js"
import type { ManagerCoreComposition } from "./core-composition.js"
import { ManagerRuntime } from "./manager-runtime.js"
import {
  createIdentityResolvers,
  type ManagerApplicationOptions,
} from "./manager-application-context.js"

const TRANSPORT_TIMEOUT_MAXIMUM_MS = 30_000
const RETRY_AFTER_SECONDS = 1

type RuntimeWiringOptions = ManagerApplicationOptions & Readonly<{
  admissions: ManagedAdmissionCoordinator
  aiTransport: ManagedAiTransportPlugin
  bodyLedger: AtomicReservationLedger
  connectionLedger: AtomicReservationLedger
  contexts: AuthorizedRequestContextStore
  core: ManagerCoreComposition
  createHeaders: ManagedCreateHeaders
  events: ManagedEventJournal
  health: RuntimeHealth
  operations: ManagerOperationsPort
  pool: ManagerPoolController
  publicSecurity: PublicRequestSecurity
  requestSecurity: RequestSecurity
  snapshots: ManagedListSnapshotStore
  webSocketLedger: WebSocketReservationLedger
}>

export function buildManagerRuntime(options: RuntimeWiringOptions): ManagerRuntime {
  const identity = {
    managerInstanceId: options.managerInstanceId,
    poolId: options.launch.poolId,
  }
  const compatibility = new ManagerCompatibilityLifecycle({
    admissions: options.admissions,
    createHeaders: async (principalId, publicSessionId) => options.createHeaders.compatibility(
      principalId,
      SessionIdSchema.parse(publicSessionId),
    ),
    lifecycle: options.core.lifecycle,
    pool: options.pool,
    registry: options.core.registry,
    wait: async (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    waitMilliseconds: CONTROL_PLANE_FIXED.compatibilityWaitMs,
  })
  const restProxy = new WorkerRestProxy({
    identity,
    maxRequestBytes: options.config.controlPlane.httpBodyBytes,
    maxResponseBytes: options.config.controlPlane.aiBinaryBytes,
    timeoutMilliseconds: boundedTimeout(options.config.controlPlane.httpRequestTimeoutMs),
    verifier: options.workerClient,
  })
  const publicGateway = new PublicRestGateway({
    lifecycle: compatibility,
    maxRequestBytes: options.config.controlPlane.httpBodyBytes,
    proxy: restProxy,
    registry: options.core.registry,
    security: options.publicSecurity,
  })
  const webSocket = new ManagedWebSocketGateway({
    bufferBytes: options.config.controlPlane.webSocketBufferBytes,
    closeTimeoutMilliseconds: boundedTimeout(options.config.controlPlane.drainTimeoutMs),
    handshakeTimeoutMilliseconds: boundedTimeout(options.config.controlPlane.probeTimeoutMs),
    identity,
    ledger: options.webSocketLedger,
    messageBytes: options.config.controlPlane.webSocketMessageBytes,
    registry: options.core.registry,
    retryAfterSeconds: RETRY_AFTER_SECONDS,
    security: options.publicSecurity,
    verifier: options.workerClient,
  })
  const resolvers = createIdentityResolvers(options.contexts)
  const poolMutations = new PoolMutationCoordinator({
    clock: options.clock,
    config: options.config.controlPlane,
  })
  const healthServer = createHealthServer({
    health: options.health,
    host: options.launch.healthHost,
    port: options.launch.healthPort,
  })
  return new ManagerRuntime({
    config: options.config,
    health: options.health,
    healthServer,
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    ports: {
      closeDependencies: async () => closeDependencies(options, publicGateway),
      drain: async () => {
        await options.pool.shutdown()
        options.admissions.shutdown()
      },
      reconciliation: options.core.loop,
      registerRoutes: async (app) => {
        await registerManagedOperationsApi(app, {
          events: options.events,
          nextRequestId: () => UuidSchema.parse(randomUUID()),
          poolMutations,
          port: options.operations,
          resolvePrincipal: resolvers.operations,
          snapshots: options.snapshots,
        })
        app.register(options.aiTransport.plugin)
        registerPublicRestBridge(app, {
          gateway: publicGateway,
          resolvePrincipal: (request) => options.contexts.require(request.raw).principal.id,
        })
      },
      webSocket,
    },
    publicHost: options.launch.publicHost,
    publicPort: options.launch.publicPort,
    publicServer: {
      bodyLedger: options.bodyLedger,
      compatibilityHealth: { read: async () => options.health.snapshot() },
      config: options.config,
      connectionLedger: options.connectionLedger,
      onConnectionRejected: () => undefined,
      requestContexts: options.contexts,
      requestSecurity: options.requestSecurity,
      uiAssets: options.uiAssets,
    },
    shutdownTimeoutMilliseconds: options.config.controlPlane.drainTimeoutMs,
  })
}

async function closeDependencies(
  options: RuntimeWiringOptions,
  publicGateway: PublicRestGateway,
): Promise<void> {
  options.aiTransport.close()
  try {
    await Promise.all([
      publicGateway.close(),
      options.workerClient.close(),
      options.closeExternalDependencies?.() ?? Promise.resolve(),
    ])
  } finally {
    options.createTokenKey.destroy()
  }
}

function boundedTimeout(milliseconds: number): number {
  return Math.min(milliseconds, TRANSPORT_TIMEOUT_MAXIMUM_MS)
}
