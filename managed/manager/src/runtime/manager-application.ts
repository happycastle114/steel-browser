import { randomUUID } from "node:crypto"
import {
  ManagedEventJournal,
  ManagedListSnapshotStore,
  PublicRequestSecurity,
  PublicSessionIdSchema,
  RandomResultIdFactory,
  WebSocketReservationLedger,
  createManagedAiTransportPlugin,
  type ManagedAiTransportPlugin,
} from "@happycastle/steel-managed-gateway"
import {
  ActionIdSchema,
  AdmissionIdSchema,
  CONTROL_PLANE_FIXED,
  SessionIdSchema,
  TOOL_VERSION,
} from "@happycastle/steel-managed-shared"
import { BrowserAutomationExecutor } from "../ai/browser-automation-executor.js"
import { ManagerAiExecutionPort } from "../ai/manager-ai-execution-port.js"
import { WorkerCdpPageFactory } from "../ai/worker-cdp-page.js"
import { RuntimeHealth } from "../health/runtime-health.js"
import { AuthorizedRequestContextStore } from "../http/request-context-store.js"
import { RequestSecurity } from "../http/request-security.js"
import {
  AtomicReservationLedger,
  ReservationLedgerKind,
} from "../memory/atomic-reservation-ledger.js"
import { ManagedAdmissionCoordinator } from "../operations/admission-coordinator.js"
import { ManagedCreateHeaders } from "../operations/managed-create-headers.js"
import { ManagerOperationsPort } from "../operations/manager-operations-port.js"
import { ManagerPoolController } from "../operations/pool-controller.js"
import { createManagerCoreComposition } from "./core-composition.js"
import type { ManagerRuntime } from "./manager-runtime.js"
import {
  SanitizedAiAuditSink,
  createIdentityResolvers,
  type ManagerApplicationOptions,
} from "./manager-application-context.js"
import { buildManagerRuntime } from "./manager-runtime-wiring.js"

const TRANSPORT_TIMEOUT_MAXIMUM_MS = 30_000

export function createManagerApplication(options: ManagerApplicationOptions): ManagerRuntime {
  const health = new RuntimeHealth()
  const contexts = new AuthorizedRequestContextStore()
  const requestSecurity = new RequestSecurity({
    authenticate: options.authenticate,
    originByHost: options.config.controlPlane.publicOriginByHost,
  })
  const publicSecurity = new PublicRequestSecurity({
    allowedOrigins: options.config.controlPlane.allowedOrigins,
    authenticate: async () => undefined,
    originByHost: options.config.controlPlane.publicOriginByHost,
  })
  const core = createManagerCoreComposition({
    client: options.workerClient,
    clock: options.clock,
    config: options.config,
    health,
    launch: options.launch,
    onReconciliationError: options.onError ?? (() => undefined),
  })
  const memory = options.config.controlPlane.memory
  const bodyLedger = new AtomicReservationLedger({
    kind: ReservationLedgerKind.INGRESS_BODY,
    limitBytes: memory.ingressBodyBudgetBytes,
    limitCount: memory.ingressBodyMax,
  })
  const connectionLedger = new AtomicReservationLedger({
    kind: ReservationLedgerKind.INGRESS_CONNECTION,
    limitBytes: memory.ingressConnectionBudgetBytes,
    limitCount: memory.ingressConnectionMax,
  })
  const webSocketLedger = new WebSocketReservationLedger({
    bufferBytes: options.config.controlPlane.webSocketBufferBytes,
    limitBytes: memory.webSocketBudgetBytes,
    limitCount: memory.webSocketMax,
    messageBytes: options.config.controlPlane.webSocketMessageBytes,
  })
  const createHeaders = new ManagedCreateHeaders({
    key: options.createTokenKey,
    managerInstanceId: options.managerInstanceId,
    poolId: options.launch.poolId,
  })
  const admissions = new ManagedAdmissionCoordinator({
    admissions: core.admissions,
    clock: options.clock,
    createHeaders: async (command, publicSessionId) => createHeaders.keyed({
      idempotencyKey: command.request.idempotencyKey,
      principalId: command.principalId,
      sessionId: SessionIdSchema.parse(publicSessionId),
    }),
    ids: { nextAdmissionId: () => AdmissionIdSchema.parse(randomUUID()) },
    lifecycle: core.lifecycle,
    registry: core.registry,
    ticketTtlMilliseconds: options.config.controlPlane.ticketTtlMs,
  })
  const snapshots = new ManagedListSnapshotStore({
    bootId: options.bootId,
    clock: options.clock,
    maxBytes: CONTROL_PLANE_FIXED.listSnapshotBytes,
    maxSnapshots: options.config.controlPlane.listSnapshotMax,
    ttlMs: options.config.controlPlane.listSnapshotTtlMs,
  })
  const events = new ManagedEventJournal({
    bootId: options.bootId,
    capacity: CONTROL_PLANE_FIXED.eventLimit,
    clock: options.clock,
  })
  let aiGauges: ManagedAiTransportPlugin["gauges"] | undefined
  const pool = new ManagerPoolController({
    action: () => requireAiGauges(aiGauges).action,
    clock: options.clock,
    config: options.config,
    ingressBody: () => bodyLedger.snapshot(),
    ingressConnection: () => connectionLedger.snapshot(),
    managerInstanceId: options.managerInstanceId,
    queueDepth: () => core.admissions.activeCount(),
    result: () => requireAiGauges(aiGauges).result,
    webSocket: () => webSocketLedger.snapshot(),
    workers: () => core.registry.workers(),
  })
  const operations = new ManagerOperationsPort({
    admissions,
    pool,
    version: options.version,
    workers: () => core.registry.workers(),
  })
  const cdpPages = new WorkerCdpPageFactory({
    commandTimeoutMilliseconds: options.config.controlPlane.actionTimeoutMs,
    connectTimeoutMilliseconds: boundedTransportTimeout(options.config.controlPlane.probeTimeoutMs),
    identity: {
      managerInstanceId: options.managerInstanceId,
      poolId: options.launch.poolId,
    },
    messageBytes: options.config.controlPlane.webSocketMessageBytes,
    resolveWorker: (session) => core.registry.workerForSession(
      PublicSessionIdSchema.parse(session.sessionId),
    ),
    verifier: options.workerClient,
  })
  const browser = new BrowserAutomationExecutor({
    actionIds: { next: () => ActionIdSchema.parse(randomUUID()) },
    clock: options.clock,
    openPage: (session, signal) => cdpPages.open(session, signal),
    textBytes: options.config.controlPlane.aiTextBytes,
  })
  const aiTransport = createManagedAiTransportPlugin({
    auditSink: new SanitizedAiAuditSink(),
    clock: options.clock,
    config: options.config.controlPlane,
    executionPort: new ManagerAiExecutionPort({
      browser,
      clock: options.clock,
      operations,
      sessionSnapshots: snapshots,
    }),
    requestIdentity: createIdentityResolvers(contexts).ai,
    resultIdFactory: new RandomResultIdFactory(),
    serviceVersion: TOOL_VERSION,
  })
  aiGauges = aiTransport.gauges
  return buildManagerRuntime({
    ...options,
    admissions,
    aiTransport,
    bodyLedger,
    connectionLedger,
    contexts,
    core,
    createHeaders,
    events,
    health,
    operations,
    pool,
    publicSecurity,
    requestSecurity,
    snapshots,
    webSocketLedger,
  })
}

function boundedTransportTimeout(milliseconds: number): number {
  return Math.min(milliseconds, TRANSPORT_TIMEOUT_MAXIMUM_MS)
}

function requireAiGauges(
  gauges: ManagedAiTransportPlugin["gauges"] | undefined,
) {
  if (gauges === undefined) throw new TypeError("managed AI gauges are not initialized")
  return gauges()
}
