import type { AdmissionTicketId, PublicSessionId } from "../domain/ids.js"
import type { ManagedCreateHeaderValues } from "@happycastle/steel-managed-shared"
import { LifecycleCreateKind } from "../domain/states.js"
import type { SessionRecord } from "../registry/registry-model.js"

export type PendingSessionCreate = {
  readonly managedCreate?: ManagedCreateHeaderValues
  readonly publicSessionId: PublicSessionId
}

export type ManagedCreateHeaderFactory = (
  publicSessionId: PublicSessionId,
) => Promise<ManagedCreateHeaderValues>

export type LifecycleCreateResult =
  | {
      readonly kind: typeof LifecycleCreateKind.CREATED
      readonly session: SessionRecord
      readonly admissionTicketId?: AdmissionTicketId
    }
  | {
      readonly kind: typeof LifecycleCreateKind.QUEUED
      readonly publicSessionId: PublicSessionId
      readonly admissionTicketId: AdmissionTicketId
    }

export type LifecycleCreatedResult = Extract<
  LifecycleCreateResult,
  { readonly kind: typeof LifecycleCreateKind.CREATED }
>

export { LifecycleCreateKind }
