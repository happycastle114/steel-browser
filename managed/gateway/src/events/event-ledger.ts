import { EventLedgerCapacityError } from "../domain/errors.js"
import { EventCursorSchema, type EventCursor } from "../domain/ids.js"
import type { Clock } from "../domain/clock.js"
import type {
  AllocationId,
  InstanceId,
  PublicSessionId,
  WorkerId,
} from "../domain/ids.js"
import type { GatewayEventType } from "../domain/states.js"

const DEFAULT_EVENT_CAPACITY = 100

export type GatewayEventInput = {
  readonly type: GatewayEventType
  readonly workerId?: WorkerId
  readonly instanceId?: InstanceId
  readonly allocationId?: AllocationId
  readonly sessionId?: PublicSessionId
}

export type GatewayEvent = GatewayEventInput & {
  readonly cursor: EventCursor
  readonly occurredAt: number
}

type EventLedgerOptions = {
  readonly clock: Clock
  readonly capacity?: number
}

export class EventLedger {
  /** Bounded append-only tail; mutation is the purpose of this in-memory ledger. */
  private events: GatewayEvent[] = []
  private sequence = 0
  private readonly capacity: number
  private readonly clock: Clock

  public constructor(options: EventLedgerOptions) {
    const capacity = options.capacity ?? DEFAULT_EVENT_CAPACITY
    if (!Number.isFinite(capacity) || !Number.isInteger(capacity) || capacity < 1) {
      throw new EventLedgerCapacityError(capacity)
    }
    this.capacity = capacity
    this.clock = options.clock
  }

  public append(input: GatewayEventInput): GatewayEvent {
    const cursor = EventCursorSchema.parse(this.sequence + 1)
    const event = { ...input, cursor, occurredAt: this.clock.now() }
    this.sequence = cursor
    this.events.push(event)
    if (this.events.length > this.capacity) this.events = this.events.slice(-this.capacity)
    return event
  }

  public readAfter(cursor = 0): readonly GatewayEvent[] {
    return this.events.filter((event) => event.cursor > cursor)
  }
}
