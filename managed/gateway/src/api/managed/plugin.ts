import {
  ToolVersionSchema,
  type ControlPlaneConfig,
  type ResultReservationSnapshot,
} from "@happycastle/steel-managed-shared"
import type { FastifyPluginCallback } from "fastify"
import type { Clock } from "../../domain/clock.js"
import { registerMcpRoutes } from "../../mcp/routes.js"
import { AiBrowserService } from "./action-service.js"
import type { ActionCapacitySnapshot } from "./action-capacity.js"
import type {
  AiAuditSink,
  ControlPlaneExecutionPort,
  ManagedRequestIdentityProvider,
} from "./execution-contract.js"
import { registerManagedRestRoutes } from "./rest-routes.js"
import type { ResultIdFactory } from "./result-id-factory.js"
import type { RetainedResultStore } from "./retained-result-store.js"

export type ManagedAiTransportPluginOptions = Readonly<{
  readonly config: ControlPlaneConfig
  readonly serviceVersion: string
  readonly executionPort: ControlPlaneExecutionPort
  readonly requestIdentity: ManagedRequestIdentityProvider
  readonly clock: Clock
  readonly resultIdFactory: ResultIdFactory
  readonly auditSink: AiAuditSink
  readonly resultStore?: RetainedResultStore | undefined
}>

export type ManagedAiTransportPlugin = Readonly<{
  readonly plugin: FastifyPluginCallback
  readonly close: () => void
  readonly gauges: () => Readonly<{
    readonly action: ActionCapacitySnapshot
    readonly result: ResultReservationSnapshot
  }>
}>

export function createManagedAiTransportPlugin(
  options: ManagedAiTransportPluginOptions,
): ManagedAiTransportPlugin {
  requireExecutionPort(options.executionPort)
  const serviceVersion = ToolVersionSchema.parse(options.serviceVersion)
  const service = new AiBrowserService(options)
  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    service.close()
  }
  const dependencies = {
    service,
    requestIdentity: options.requestIdentity,
    config: options.config,
    serviceVersion,
  } as const
  const plugin: FastifyPluginCallback = (app, _pluginOptions, done) => {
    app.addHook("onClose", (_instance, hookDone) => {
      close()
      hookDone()
    })
    registerManagedRestRoutes(app, dependencies)
    registerMcpRoutes(app, dependencies)
    done()
  }
  return Object.freeze({ plugin, close, gauges: () => service.gauges() })
}

function requireExecutionPort(port: ControlPlaneExecutionPort | undefined): asserts port is ControlPlaneExecutionPort {
  if (port === undefined || typeof port.execute !== "function") {
    throw new TypeError("managed AI execution port is required before listener startup")
  }
}
