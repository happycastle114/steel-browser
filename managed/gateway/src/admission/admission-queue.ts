import {
  AdmissionAbortedError,
  AdmissionBackpressureError,
  AdmissionConfigurationError,
  AdmissionConfigurationField,
} from "../domain/errors.js"
import { assertNever } from "../domain/exhaustive.js"
import type { AdmissionTicketId, AllocationId } from "../domain/ids.js"
import { AdmissionState } from "../domain/states.js"
import type {
  AdmissionQueueOptions,
  AdmissionSettlement,
  AdmissionTicket,
  MutableAdmissionRecord,
} from "./admission-model.js"
import { AdmissionRecordStore } from "./admission-record-store.js"

export class AdmissionQueue<T> {
  private queuedIds: AdmissionTicketId[] = []
  private readonly records: AdmissionRecordStore<T>
  private readonly options: AdmissionQueueOptions

  public constructor(options: AdmissionQueueOptions) {
    if (!isPositiveInteger(options.capacity)) {
      throw new AdmissionConfigurationError(AdmissionConfigurationField.CAPACITY, options.capacity)
    }
    if (!isPositiveInteger(options.ticketTtlMilliseconds)) {
      throw new AdmissionConfigurationError(
        AdmissionConfigurationField.TICKET_TTL_MILLISECONDS,
        options.ticketTtlMilliseconds,
      )
    }
    this.options = options
    const terminalCapacity = options.retainedTerminalCapacity ?? options.capacity
    if (!isPositiveInteger(terminalCapacity)) {
      throw new AdmissionConfigurationError(
        AdmissionConfigurationField.RETAINED_TERMINAL_CAPACITY,
        terminalCapacity,
      )
    }
    this.records = new AdmissionRecordStore(options.clock, terminalCapacity)
  }

  public enqueue(payload: T, signal?: AbortSignal): AdmissionTicket<T> {
    if (signal?.aborted === true) throw new AdmissionAbortedError()
    this.expireDue()
    if (this.queuedIds.length >= this.options.capacity) {
      throw new AdmissionBackpressureError(this.options.capacity)
    }
    const createdAt = this.options.clock.now()
    const ticket = {
      id: this.options.ids.nextAdmissionTicketId(),
      payload,
      createdAt,
      expiresAt: createdAt + this.options.ticketTtlMilliseconds,
      state: AdmissionState.QUEUED,
    } as const
    const record: MutableAdmissionRecord<T> = { ticket }
    if (signal !== undefined) {
      const abortListener = () => {
        this.cancel(ticket.id)
      }
      signal.addEventListener("abort", abortListener, { once: true })
      record.abortSignal = signal
      record.abortListener = abortListener
    }
    this.records.add(record)
    this.queuedIds.push(ticket.id)
    return ticket
  }

  public reserveNext(allocationId: AllocationId): AdmissionTicket<T> | undefined {
    this.expireDue()
    const ticketId = this.queuedIds.shift()
    if (ticketId === undefined) return undefined
    const record = this.records.require(ticketId)
    if (record.ticket.state !== AdmissionState.QUEUED) return this.reserveNext(allocationId)
    const reserved = { ...record.ticket, state: AdmissionState.RESERVED, allocationId } as const
    record.ticket = reserved
    return reserved
  }

  public cancel(ticketId: AdmissionTicketId): AdmissionSettlement<T> {
    const record = this.records.require(ticketId)
    switch (record.ticket.state) {
      case AdmissionState.QUEUED:
        this.queuedIds = this.queuedIds.filter((queuedId) => queuedId !== ticketId)
        return this.records.settleQueued(record, AdmissionState.CANCELLED)
      case AdmissionState.RESERVED:
        return this.records.settleReserved(record, AdmissionState.CANCELLED)
      case AdmissionState.CANCELLED:
      case AdmissionState.EXPIRED:
      case AdmissionState.COMPLETED:
      case AdmissionState.SHUTDOWN:
        return { ticket: record.ticket }
      default:
        return assertNever(record.ticket)
    }
  }

  public complete(ticketId: AdmissionTicketId): AdmissionSettlement<T> {
    const record = this.records.require(ticketId)
    if (record.ticket.state !== AdmissionState.RESERVED) return { ticket: record.ticket }
    return this.records.settleReserved(record, AdmissionState.COMPLETED)
  }

  public expireDue(): readonly AdmissionSettlement<T>[] {
    const now = this.options.clock.now()
    const settlements: AdmissionSettlement<T>[] = []
    for (const record of this.records.values()) {
      if (
        (record.ticket.state === AdmissionState.QUEUED ||
          record.ticket.state === AdmissionState.RESERVED) &&
        record.ticket.expiresAt <= now
      ) {
        this.queuedIds = this.queuedIds.filter((ticketId) => ticketId !== record.ticket.id)
        settlements.push(
          record.ticket.state === AdmissionState.QUEUED
            ? this.records.settleQueued(record, AdmissionState.EXPIRED)
            : this.records.settleReserved(record, AdmissionState.EXPIRED),
        )
      }
    }
    return settlements
  }

  public shutdown(): readonly AdmissionSettlement<T>[] {
    const settlements: AdmissionSettlement<T>[] = []
    for (const record of this.records.values()) {
      if (
        record.ticket.state === AdmissionState.QUEUED ||
        record.ticket.state === AdmissionState.RESERVED
      ) {
        settlements.push(
          record.ticket.state === AdmissionState.QUEUED
            ? this.records.settleQueued(record, AdmissionState.SHUTDOWN)
            : this.records.settleReserved(record, AdmissionState.SHUTDOWN),
        )
      }
    }
    this.queuedIds = []
    return settlements
  }

  public get(ticketId: AdmissionTicketId): AdmissionTicket<T> | undefined {
    return this.records.ticket(ticketId)
  }

  public activeCount(): number {
    return [...this.records.values()].filter(
      ({ ticket }) =>
        ticket.state === AdmissionState.QUEUED || ticket.state === AdmissionState.RESERVED,
    ).length
  }

  public terminalCount(): number {
    return this.records.terminalCount()
  }
}

function isPositiveInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0
}
