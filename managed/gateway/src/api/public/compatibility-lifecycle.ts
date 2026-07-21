import type { PublicSessionId } from "../../domain/ids.js"
import type { SessionRecord } from "../../registry/registry-model.js"
import type { PublicHttpMethod, UpstreamHttpResponse } from "./schemas.js"
import type { PrincipalId } from "@happycastle/steel-managed-shared"

export type CompatibilityLifecycleRequest = {
  readonly body?: Buffer
  readonly headers: Readonly<Record<string, string | undefined>>
  readonly method: PublicHttpMethod
  readonly pathAndQuery: string
  readonly principalId?: PrincipalId
  readonly signal: AbortSignal
}

export type CompatibilityLifecycleResult = {
  readonly response: UpstreamHttpResponse
  readonly session: SessionRecord
}

export interface CompatibilitySessionLifecycle {
  create(request: CompatibilityLifecycleRequest): Promise<CompatibilityLifecycleResult>
  release(
    sessionId: PublicSessionId,
    request: CompatibilityLifecycleRequest,
  ): Promise<CompatibilityLifecycleResult>
}
