import { createHash } from "node:crypto"
import {
  type AiAuditEvent,
  type AiAuditSink,
  type ManagedPrincipal,
  type ManagedRequestIdentity,
  type WorkerGenerationVerifier,
  type WorkerHttpClient,
} from "@happycastle/steel-managed-gateway"
import {
  Sha256Schema,
  UuidSchema,
  type BootId,
  type ManagerInstanceId,
  type Version,
} from "@happycastle/steel-managed-shared"
import type { FastifyRequest } from "fastify"
import type { AuthenticatedPrincipal, AuthenticationHeaders } from "../auth/jwt-authenticator.js"
import type { ManagerConfig } from "../config.js"
import type { ManagerLaunchConfig } from "../launch-config.js"
import type { CreateTokenKeyMaterial } from "../secret/create-token-key.js"
import type { UiAssetManifest } from "../ui/asset-manifest.js"
import type { AuthorizedRequestContextStore } from "../http/request-context-store.js"

export interface ManagerApplicationClock {
  now(): number
  nowMilliseconds(): number
}

export type ManagerWorkerClient = WorkerHttpClient & WorkerGenerationVerifier & Readonly<{
  close(): Promise<void>
}>

export type ManagerApplicationOptions = Readonly<{
  authenticate(headers: AuthenticationHeaders): Promise<AuthenticatedPrincipal>
  bootId: BootId
  clock: ManagerApplicationClock
  closeExternalDependencies?: () => Promise<void>
  config: ManagerConfig
  createTokenKey: CreateTokenKeyMaterial
  launch: ManagerLaunchConfig
  managerInstanceId: ManagerInstanceId
  onError?: (error: unknown) => void
  uiAssets: Readonly<{ manifest: UiAssetManifest; root: string }>
  version: Version
  workerClient: ManagerWorkerClient
}>

export function createIdentityResolvers(contexts: AuthorizedRequestContextStore) {
  const operations = (request: FastifyRequest): ManagedPrincipal => {
    const principal = contexts.require(request.raw).principal
    return {
      principalDigest: Sha256Schema.parse(
        createHash("sha256").update(principal.id).digest("hex"),
      ),
      principalId: principal.id,
      role: principal.role,
    }
  }
  const ai = (request: FastifyRequest): ManagedRequestIdentity => {
    const authorized = contexts.require(request.raw)
    const requestId = UuidSchema.parse(request.id)
    return {
      context: { correlationId: requestId, requestId },
      principal: {
        principalId: authorized.principal.id,
        role: authorized.principal.role,
      },
      selectedOrigin: authorized.publicOrigin,
    }
  }
  return { ai, operations }
}

export class SanitizedAiAuditSink implements AiAuditSink {
  readonly #counts = new Map<AiAuditEvent["reason"], number>()

  public record(event: AiAuditEvent): void {
    this.#counts.set(event.reason, (this.#counts.get(event.reason) ?? 0) + 1)
  }

  public snapshot(): ReadonlyMap<AiAuditEvent["reason"], number> {
    return new Map(this.#counts)
  }
}
