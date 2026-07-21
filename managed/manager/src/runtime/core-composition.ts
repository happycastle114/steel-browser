import {
  AdmissionQueue,
  EventLedger,
  RandomIdGenerator,
  SessionLifecycleCoordinator,
  StaticWorkerConfigSchema,
  StaticWorkerProvider,
  SystemClock,
  WorkerReconciler,
  WorkerRegistry,
  type Clock,
  type IdGenerator,
  type PendingSessionCreate,
  type WorkerHttpClient,
} from "@happycastle/steel-managed-gateway"
import { CONTROL_PLANE_FIXED } from "@happycastle/steel-managed-shared"
import type { ManagerConfig } from "../config.js"
import type { RuntimeHealth } from "../health/runtime-health.js"
import type { ManagerLaunchConfig } from "../launch-config.js"
import { ReconciliationLoop } from "./reconciliation-loop.js"

type ManagerCoreCompositionOptions = Readonly<{
  client: WorkerHttpClient
  clock?: Clock
  config: ManagerConfig
  health: RuntimeHealth
  ids?: IdGenerator
  launch: ManagerLaunchConfig
  onReconciliationError: (error: unknown) => void
}>

export type ManagerCoreComposition = Readonly<{
  admissions: AdmissionQueue<PendingSessionCreate>
  client: WorkerHttpClient
  events: EventLedger
  lifecycle: SessionLifecycleCoordinator
  loop: ReconciliationLoop
  provider: StaticWorkerProvider
  reconciler: WorkerReconciler
  registry: WorkerRegistry
}>

export function createManagerCoreComposition(
  options: ManagerCoreCompositionOptions,
): ManagerCoreComposition {
  const clock = options.clock ?? new SystemClock()
  const ids = options.ids ?? new RandomIdGenerator()
  const events = new EventLedger({
    capacity: CONTROL_PLANE_FIXED.eventLimit,
    clock,
  })
  const registry = new WorkerRegistry({ clock, ledger: events })
  const admissions = new AdmissionQueue<PendingSessionCreate>({
    capacity: options.config.controlPlane.queueMax,
    clock,
    ids,
    retainedTerminalCapacity: options.config.controlPlane.terminalSessionMax,
    ticketTtlMilliseconds: options.config.controlPlane.ticketTtlMs,
  })
  const provider = new StaticWorkerProvider(
    StaticWorkerConfigSchema.parse({
      workers: options.launch.workers.map(({ id, origin }) => ({
        origin: origin.origin,
        workerId: id,
      })),
    }),
  )
  const lifecycle = new SessionLifecycleCoordinator({
    admissions,
    client: options.client,
    ids,
    registry,
  })
  const reconciler = new WorkerReconciler({
    client: options.client,
    provider,
    registry,
  })
  const loop = new ReconciliationLoop({
    admissions: lifecycle,
    health: options.health,
    intervalMilliseconds: options.config.controlPlane.reconcileMs,
    onError: options.onReconciliationError,
    reconciler,
    registry,
  })
  return Object.freeze({
    admissions,
    client: options.client,
    events,
    lifecycle,
    loop,
    provider,
    reconciler,
    registry,
  })
}
