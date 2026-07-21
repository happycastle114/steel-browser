import type {
  PrincipalId,
  ResultId,
  SelectedPublicOrigin,
} from "@happycastle/steel-managed-shared"

import { ActionJobOutcomeKind } from "../../domain/states.js"
import type { ManagedTransportError } from "./transport-error.js"
import type { CompletedAction } from "./service-contract.js"

export type ActionJobOutcome =
  | Readonly<{
    readonly kind: typeof ActionJobOutcomeKind.COMPLETED
    readonly value: CompletedAction
  }>
  | Readonly<{
    readonly kind: typeof ActionJobOutcomeKind.FAILED
    readonly error: ManagedTransportError
  }>

export type ActionJob = Readonly<{
  readonly resultId: ResultId
  readonly creatorId: PrincipalId
  readonly selectedOrigin: SelectedPublicOrigin
  readonly done: Promise<ActionJobOutcome>
}>
