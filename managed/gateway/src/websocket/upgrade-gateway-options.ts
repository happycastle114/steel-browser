import { z } from "zod"
import type { WorkerGenerationVerifier } from "../api/public/proxy.js"
import type { PublicRequestSecurity } from "../api/public/security.js"
import type { WorkerRegistry } from "../registry/worker-registry.js"
import type { WebSocketReservationLedger } from "./duplex-proxy.js"

const ManagedWebSocketGatewayOptionsSchema = z
  .object({
    bufferBytes: z.number().int().positive().safe(),
    closeTimeoutMilliseconds: z.number().int().positive().max(30_000),
    handshakeTimeoutMilliseconds: z.number().int().positive().max(30_000),
    identity: z
      .object({
        managerInstanceId: z.string().uuid(),
        poolId: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/u),
      })
      .strict()
      .readonly(),
    messageBytes: z.number().int().positive().safe(),
    retryAfterSeconds: z.number().int().positive().safe(),
  })
  .strict()
  .readonly()

export type ManagedWebSocketGatewayOptions =
  z.input<typeof ManagedWebSocketGatewayOptionsSchema> & {
    readonly ledger: WebSocketReservationLedger
    readonly registry: WorkerRegistry
    readonly security: PublicRequestSecurity
    readonly verifier: WorkerGenerationVerifier
  }

export function parseManagedWebSocketGatewayOptions(input: ManagedWebSocketGatewayOptions) {
  return ManagedWebSocketGatewayOptionsSchema.parse({
    bufferBytes: input.bufferBytes,
    closeTimeoutMilliseconds: input.closeTimeoutMilliseconds,
    handshakeTimeoutMilliseconds: input.handshakeTimeoutMilliseconds,
    identity: input.identity,
    messageBytes: input.messageBytes,
    retryAfterSeconds: input.retryAfterSeconds,
  })
}
