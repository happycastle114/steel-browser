import {
  AdmissionAbortedError,
  AdmissionBackpressureError,
  AdmissionConfigurationError,
  AdmissionConfigurationField,
  AdmissionTicketNotFoundError,
  AdmissionTransitionError,
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

export class AdmissionQueue<T> {
  /** Queue and records are mutable because this class owns FIFO admission state. */
  private queuedIds: AdmissionTicketId[] = []
  private readonly records = new Map<AdmissionTicketId, MutableAdmissionRecord<T>>()
  private readonly terminalIds: AdmissionTicketId[] = []
  private readonly options: AdmissionQueueOptions
  private readonly terminalCapacity: number

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
    this.terminalCapacity = options.retainedTerminalCapacity ?? options.capacity
    if (!isPositiveInteger(this.terminalCapacity)) {
      throw new AdmissionConfigurationError(
        AdmissionConfigurationField.RETAINED_TERMINAL_CAPACITY,
        this.terminalCapacity,
      )
    }
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
    this.records.set(ticket.id, record)
    this.queuedIds.push(ticket.id)
    return ticket
  }

  public reserveNext(allocationId: AllocationId): AdmissionTicket<T> | undefined {
    this.expireDue()
    const ticketId = this.queuedIds.shift()
    if (ticketId === undefined) return undefined
    const record = this.requireRecord(ticketId)
    if (record.ticket.state !== AdmissionState.QUEUED) return this.reserveNext(allocationId)
    const reserved = { ...record.ticket, state: AdmissionState.RESERVED, allocationId } as const
    record.ticket = reserved
    return reserved
  }

  public cancel(ticketId: AdmissionTicketId): AdmissionSettlement<T> {
    const record = this.requireRecord(ticketId)
    switch (record.ticket.state) {
      case AdmissionState.QUEUED:
        this.queuedIds = this.queuedIds.filter((queuedId) => queuedId !== ticketId)
        return this.settleQueued(record, AdmissionState.CANCELLED)
      case AdmissionState.RESERVED:
        return this.settleReserved(record, AdmissionState.CANCELLED)
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
    const record = this.requireRecord(ticketId)
    if (record.ticket.state !== AdmissionState.RESERVED) return { ticket: record.ticket }
    return this.settleReserved(record, AdmissionState.COMPLETED)
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
            ? this.settleQueued(record, AdmissionState.EXPIRED)
            : this.settleReserved(record, AdmissionState.EXPIRED),
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
            ? this.settleQueued(record, AdmissionState.SHUTDOWN)
            : this.settleReserved(record, AdmissionState.SHUTDOWN),
        )
      }
    }
    this.queuedIds = []
    return settlements
  }

  public get(ticketId: AdmissionTicketId): AdmissionTicket<T> | undefined {
    return this.records.get(ticketId)?.ticket
  }

  public activeCount(): number {
    return [...this.records.values()].filter(
      ({ ticket }) =>
        ticket.state === AdmissionState.QUEUED || ticket.state === AdmissionState.RESERVED,
    ).length
  }

  public terminalCount(): number {
    return this.terminalIds.length
  }

  private settleQueued(
    record: MutableAdmissionRecord<T>,
    state:
      | typeof AdmissionState.CANCELLED
      | typeof AdmissionState.EXPIRED
      | typeof AdmissionState.SHUTDOWN,
  ): AdmissionSettlement<T> {
    const previous = record.ticket
    if (previous.state !== AdmissionState.QUEUED) {
      throw new AdmissionTransitionError(previous.id)
    }
    const terminalAt = this.options.clock.now()
    const terminal = { ...previous, state, terminalAt }
    record.ticket = terminal
    this.detachAbort(record)
    this.terminalIds.push(record.ticket.id)
    this.evictTerminalOverflow()
    return { ticket: record.ticket }
  }

  private settleReserved(
    record: MutableAdmissionRecord<T>,
    state:
      | typeof AdmissionState.CANCELLED
      | typeof AdmissionState.EXPIRED
      | typeof AdmissionState.COMPLETED
      | typeof AdmissionState.SHUTDOWN,
  ): AdmissionSettlement<T> {
    const previous = record.ticket
    if (previous.state !== AdmissionState.RESERVED) {
      throw new AdmissionTransitionError(previous.id)
    }
    const terminal = { ...previous, state, terminalAt: this.options.clock.now() }
    record.ticket = terminal
    this.detachAbort(record)
    this.terminalIds.push(record.ticket.id)
    this.evictTerminalOverflow()
    return { ticket: record.ticket, releasedAllocationId: previous.allocationId }
  }

  private detachAbort(record: MutableAdmissionRecord<T>): void {
    if (record.abortSignal !== undefined && record.abortListener !== undefined) {
      record.abortSignal.removeEventListener("abort", record.abortListener)
      delete record.abortSignal
      delete record.abortListener
    }
  }

  private evictTerminalOverflow(): void {
    while (this.terminalIds.length > this.terminalCapacity) {
      const evicted = this.terminalIds.shift()
      if (evicted !== undefined) this.records.delete(evicted)
    }
  }

  private requireRecord(ticketId: AdmissionTicketId): MutableAdmissionRecord<T> {
    const record = this.records.get(ticketId)
    if (record === undefined) throw new AdmissionTicketNotFoundError(ticketId)
    return record
  }
}

function isPositiveInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0
}
