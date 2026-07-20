import type { Clock, IdGenerator } from "../domain/clock.js"
import type { AdmissionTicketId, AllocationId } from "../domain/ids.js"
import { AdmissionState } from "../domain/states.js"

export type AdmissionQueueOptions = {
  readonly capacity: number
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly ticketTtlMilliseconds: number
  readonly retainedTerminalCapacity?: number
}

type AdmissionBase<T> = {
  readonly id: AdmissionTicketId
  readonly payload: T
  readonly createdAt: number
  readonly expiresAt: number
}

export type AdmissionTicket<T> =
  | (AdmissionBase<T> & { readonly state: typeof AdmissionState.QUEUED })
  | (AdmissionBase<T> & {
      readonly state: typeof AdmissionState.RESERVED
      readonly allocationId: AllocationId
    })
  | (AdmissionBase<T> & {
      readonly state:
        | typeof AdmissionState.CANCELLED
        | typeof AdmissionState.EXPIRED
        | typeof AdmissionState.SHUTDOWN
      readonly allocationId?: AllocationId
      readonly terminalAt: number
    })
  | (AdmissionBase<T> & {
      readonly state: typeof AdmissionState.COMPLETED
      readonly allocationId: AllocationId
      readonly terminalAt: number
    })

export type AdmissionSettlement<T> = {
  readonly ticket: AdmissionTicket<T>
  readonly releasedAllocationId?: AllocationId
}

/** Abort listener cleanup is mutable because exact-once settlement is this record's purpose. */
export type MutableAdmissionRecord<T> = {
  ticket: AdmissionTicket<T>
  abortSignal?: AbortSignal
  abortListener?: () => void
}

export { AdmissionState }
