import { CONTROL_PLANE_FIXED, type ControlPlaneConfig } from "./control-plane-config.js"
import { deriveManagedTransportConfig, type ManagedTransportConfig } from "./managed-transport-config.js"
import type { PublicOrigin } from "./public-urls.js"

export type ManagedServiceCapability = Readonly<{
  readonly httpHeaderBytes: number
  readonly httpConnectionCount: number
  readonly httpConnectionReservedBytes: number
  readonly httpBodyCount: number
  readonly httpBodyReservedBytes: number
  readonly resultCount: number
  readonly actionTimeoutMs: number
  readonly actionCount: number
  readonly webSocketCount: number
  readonly webSocketReservedBytes: number
}>

export type ManagedServiceLimits = Readonly<{
  readonly publicOriginByHost: Readonly<Record<string, PublicOrigin>>
  readonly allowedOrigins: readonly PublicOrigin[]
  readonly transport: ManagedTransportConfig
  readonly resultTtlMs: number
  readonly capability: ManagedServiceCapability
}>

export function deriveManagedServiceLimits(config: ControlPlaneConfig): ManagedServiceLimits {
  return Object.freeze({
    publicOriginByHost: Object.freeze({ ...config.publicOriginByHost }),
    allowedOrigins: Object.freeze([...config.allowedOrigins]),
    transport: Object.freeze(deriveManagedTransportConfig(config)),
    resultTtlMs: config.aiResultTtlMs,
    capability: Object.freeze({
      httpHeaderBytes: CONTROL_PLANE_FIXED.httpHeaderBytes,
      httpConnectionCount: config.memory.ingressConnectionMax,
      httpConnectionReservedBytes: config.memory.httpConnectionReservationBytes,
      httpBodyCount: config.memory.ingressBodyMax,
      httpBodyReservedBytes: config.memory.httpBodyReservationBytes,
      resultCount: config.memory.resultCountLimit,
      actionTimeoutMs: config.actionTimeoutMs,
      actionCount: config.memory.actionMax,
      webSocketCount: config.memory.webSocketMax,
      webSocketReservedBytes: config.memory.webSocketReservationBytes,
    }),
  })
}
