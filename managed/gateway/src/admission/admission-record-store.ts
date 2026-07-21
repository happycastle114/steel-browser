import {
  AdmissionTicketNotFoundError,
  AdmissionTransitionError,
} from "../domain/errors.js"
import type { Clock } from "../domain/clock.js"
import type { AdmissionTicketId } from "../domain/ids.js"
import { AdmissionState } from "../domain/states.js"
import type {
  AdmissionSettlement,
  AdmissionTicket,
  MutableAdmissionRecord,
} from "./admission-model.js"

type QueuedTerminalState =
  | typeof AdmissionState.CANCELLED
  | typeof AdmissionState.EXPIRED
  | typeof AdmissionState.SHUTDOWN

type ReservedTerminalState =
  | QueuedTerminalState
  | typeof AdmissionState.COMPLETED

export class AdmissionRecordStore<T> {
  private readonly records = new Map<AdmissionTicketId, MutableAdmissionRecord<T>>()
  private readonly terminalIds: AdmissionTicketId[] = []

  public constructor(
    private readonly clock: Clock,
    private readonly terminalCapacity: number,
  ) {}

  public add(record: MutableAdmissionRecord<T>): void {
    this.records.set(record.ticket.id, record)
  }

  public ticket(ticketId: AdmissionTicketId): AdmissionTicket<T> | undefined {
    return this.records.get(ticketId)?.ticket
  }

  public values(): IterableIterator<MutableAdmissionRecord<T>> {
    return this.records.values()
  }

  public terminalCount(): number {
    return this.terminalIds.length
  }

  public require(ticketId: AdmissionTicketId): MutableAdmissionRecord<T> {
    const record = this.records.get(ticketId)
    if (record === undefined) throw new AdmissionTicketNotFoundError(ticketId)
    return record
  }

  public settleQueued(
    record: MutableAdmissionRecord<T>,
    state: QueuedTerminalState,
  ): AdmissionSettlement<T> {
    const previous = record.ticket
    if (previous.state !== AdmissionState.QUEUED) {
      throw new AdmissionTransitionError(previous.id)
    }
    record.ticket = { ...previous, state, terminalAt: this.clock.now() }
    this.finish(record)
    return { ticket: record.ticket }
  }

  public settleReserved(
    record: MutableAdmissionRecord<T>,
    state: ReservedTerminalState,
  ): AdmissionSettlement<T> {
    const previous = record.ticket
    if (previous.state !== AdmissionState.RESERVED) {
      throw new AdmissionTransitionError(previous.id)
    }
    record.ticket = { ...previous, state, terminalAt: this.clock.now() }
    this.finish(record)
    return { ticket: record.ticket, releasedAllocationId: previous.allocationId }
  }

  private finish(record: MutableAdmissionRecord<T>): void {
    if (record.abortSignal !== undefined && record.abortListener !== undefined) {
      record.abortSignal.removeEventListener("abort", record.abortListener)
      delete record.abortSignal
      delete record.abortListener
    }
    this.terminalIds.push(record.ticket.id)
    while (this.terminalIds.length > this.terminalCapacity) {
      const evicted = this.terminalIds.shift()
      if (evicted !== undefined) this.records.delete(evicted)
    }
  }
}
