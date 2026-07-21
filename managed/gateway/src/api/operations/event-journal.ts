import {
  CONTROL_PLANE_API_VERSION,
  CanonicalCursorSequenceSchema,
  EventListSchema,
  EventQuerySchema,
  EventSequenceSchema,
  IsoTimeSchema,
  MANAGED_ERROR_CODE,
  ManagedEventSchema,
  encodeEventCursor,
  decodeEventCursor,
  parseSequenceBigInt,
  type BootId,
  type ManagedEvent,
} from "@happycastle/steel-managed-shared";
import {
  ManagedOperationsConfigurationError,
  ManagedOperationsError,
} from "./errors.js";
import type { ManagedOperationsClock } from "./list-types.js";

type ManagedEventServerField =
  | "apiVersion"
  | "bootId"
  | "eventId"
  | "occurredAt"
  | "sequence";

export type ManagedEventDraft = ManagedEvent extends infer Event
  ? Event extends ManagedEvent
    ? Omit<Event, ManagedEventServerField>
    : never
  : never;

export type ManagedEventReadInput = Readonly<{
  cursor?: string;
  pageSize: number;
  snapshotCursor?: string;
}>;

export type ManagedEventJournalOptions = Readonly<{
  bootId: BootId;
  capacity: number;
  clock: ManagedOperationsClock;
}>;

type JournalEntry = Readonly<{ event: ManagedEvent; sequence: bigint }>;

export class ManagedEventSequenceExhaustedError extends Error {
  public override readonly name = "ManagedEventSequenceExhaustedError";
}

export class ManagedEventJournal {
  private readonly bootId: BootId;
  private readonly capacity: number;
  private readonly clock: ManagedOperationsClock;
  private entries: JournalEntry[] = [];
  private evictedThrough = 0n;
  private sequence = 0n;

  public constructor(options: ManagedEventJournalOptions) {
    if (!Number.isSafeInteger(options.capacity) || options.capacity < 1) {
      throw new ManagedOperationsConfigurationError(
        "event capacity must be a positive safe integer",
      );
    }
    this.bootId = options.bootId;
    this.capacity = options.capacity;
    this.clock = options.clock;
  }

  public append(draft: ManagedEventDraft): ManagedEvent {
    const nextSequence = this.sequence + 1n;
    const parsedSequence = EventSequenceSchema.safeParse(
      nextSequence.toString(),
    );
    if (!parsedSequence.success)
      throw new ManagedEventSequenceExhaustedError("event sequence exhausted");
    const sequence = parsedSequence.data;
    const event = ManagedEventSchema.parse({
      ...draft,
      apiVersion: CONTROL_PLANE_API_VERSION,
      bootId: this.bootId,
      eventId: `${this.bootId}:${sequence}`,
      occurredAt: IsoTimeSchema.parse(new Date(this.clock.now()).toISOString()),
      sequence,
    });
    this.sequence = nextSequence;
    this.entries.push({ event, sequence: nextSequence });
    if (this.entries.length > this.capacity) {
      const evicted = this.entries.shift();
      if (evicted !== undefined) this.evictedThrough = evicted.sequence;
    }
    return event;
  }

  public read(input: ManagedEventReadInput) {
    const pageSize = EventQuerySchema.shape.pageSize.safeParse(input.pageSize);
    if (!pageSize.success) {
      throw new ManagedOperationsError({
        code: MANAGED_ERROR_CODE.INVALID_ARGUMENT,
        message: "Invalid event page size",
      });
    }
    if (input.snapshotCursor !== undefined && input.cursor === undefined)
      throw invalidEventCursor();
    const predecessor =
      input.cursor === undefined
        ? this.evictedThrough
        : this.parseCursor(input.cursor);
    if (predecessor < this.evictedThrough) {
      throw new ManagedOperationsError({
        code: MANAGED_ERROR_CODE.EVENT_CURSOR_EXPIRED,
        details: { oldestCursor: this.cursor(this.evictedThrough) },
        message: "Event cursor expired",
      });
    }
    if (predecessor > this.sequence) throw invalidEventCursor();
    const snapshot =
      input.snapshotCursor === undefined
        ? this.sequence
        : this.parseCursor(input.snapshotCursor);
    if (snapshot < predecessor || snapshot > this.sequence)
      throw invalidEventCursor();
    const candidates = this.entries.filter(
      (entry) => entry.sequence > predecessor && entry.sequence <= snapshot,
    );
    const items = candidates.slice(0, pageSize.data).map(({ event }) => event);
    const last = items.length === 0 ? undefined : candidates[items.length - 1];
    const nextSequence = last?.sequence ?? predecessor;
    return EventListSchema.parse({
      apiVersion: CONTROL_PLANE_API_VERSION,
      items,
      nextCursor: this.cursor(nextSequence),
      snapshotCursor: this.cursor(snapshot),
      hasMore: candidates.length > items.length,
    });
  }

  private cursor(sequence: bigint) {
    return encodeEventCursor({
      v: 1,
      b: this.bootId,
      s: CanonicalCursorSequenceSchema.parse(sequence.toString()),
    });
  }

  private parseCursor(cursor: string): bigint {
    const payload = decodeCursor(cursor);
    if (payload.b !== this.bootId) {
      throw new ManagedOperationsError({
        code: MANAGED_ERROR_CODE.EVENT_CURSOR_RESTARTED,
        details: { resetCursor: this.cursor(this.evictedThrough) },
        message: "Event cursor belongs to another manager boot",
      });
    }
    return parseSequenceBigInt(payload.s);
  }
}

function decodeCursor(cursor: string) {
  try {
    return decodeEventCursor(cursor);
  } catch {
    throw invalidEventCursor();
  }
}

function invalidEventCursor() {
  return new ManagedOperationsError({
    code: MANAGED_ERROR_CODE.INVALID_CURSOR,
    message: "Invalid event cursor",
  });
}
