import { describe, expect, it } from "vitest";
import {
  CanonicalCursorSequenceSchema,
  MANAGED_ERROR_CODE,
  decodeEventCursor,
  encodeEventCursor,
} from "@happycastle/steel-managed-shared";
import { ManagedEventJournal } from "../src/api/operations/index.js";
import {
  EVENT_BOOT_ID,
  EventClock,
  OTHER_EVENT_BOOT_ID,
  managedEventError,
  sessionEvent,
} from "./managed-event-test-support.js";

describe("ManagedEventJournal", () => {
  it("polls losslessly from the empty predecessor cursor to the first event", () => {
    // Given
    const journal = new ManagedEventJournal({
      bootId: EVENT_BOOT_ID,
      capacity: 10,
      clock: new EventClock(),
    });
    const empty = journal.read({ pageSize: 50 });

    // When
    journal.append(sessionEvent(1));
    const first = journal.read({ cursor: empty.nextCursor, pageSize: 50 });

    // Then
    expect(decodeEventCursor(empty.nextCursor).s).toBe("0");
    expect(first.items.map(({ sequence }) => sequence)).toEqual(["1"]);
    expect(first.hasMore).toBe(false);
  });

  it("walks oldest-first through a fixed snapshot while concurrent appends wait", () => {
    // Given
    const journal = new ManagedEventJournal({
      bootId: EVENT_BOOT_ID,
      capacity: 10,
      clock: new EventClock(),
    });
    journal.append(sessionEvent(1));
    journal.append(sessionEvent(2));
    journal.append(sessionEvent(3));
    const first = journal.read({ pageSize: 1 });

    // When
    journal.append(sessionEvent(4));
    const second = journal.read({
      cursor: first.nextCursor,
      pageSize: 1,
      snapshotCursor: first.snapshotCursor,
    });
    const third = journal.read({
      cursor: second.nextCursor,
      pageSize: 1,
      snapshotCursor: second.snapshotCursor,
    });
    const nextPoll = journal.read({ cursor: third.nextCursor, pageSize: 10 });

    // Then
    expect([
      first.items[0]?.sequence,
      second.items[0]?.sequence,
      third.items[0]?.sequence,
    ]).toEqual(["1", "2", "3"]);
    expect(
      new Set([
        first.snapshotCursor,
        second.snapshotCursor,
        third.snapshotCursor,
      ]).size,
    ).toBe(1);
    expect(third.hasMore).toBe(false);
    expect(nextPoll.items.map(({ sequence }) => sequence)).toEqual(["4"]);
  });

  it("accepts cursor equality at evictedThrough and expires only older predecessors", () => {
    // Given
    const journal = new ManagedEventJournal({
      bootId: EVENT_BOOT_ID,
      capacity: 2,
      clock: new EventClock(),
    });
    journal.append(sessionEvent(1));
    journal.append(sessionEvent(2));
    journal.append(sessionEvent(3));
    const equalityCursor = encodeEventCursor({
      v: 1,
      b: EVENT_BOOT_ID,
      s: CanonicalCursorSequenceSchema.parse("1"),
    });
    const olderCursor = encodeEventCursor({
      v: 1,
      b: EVENT_BOOT_ID,
      s: CanonicalCursorSequenceSchema.parse("0"),
    });

    // When
    const valid = journal.read({ cursor: equalityCursor, pageSize: 10 });
    const expired = managedEventError(() =>
      journal.read({ cursor: olderCursor, pageSize: 10 }),
    );

    // Then
    expect(valid.items.map(({ sequence }) => sequence)).toEqual(["2", "3"]);
    expect(expired.code).toBe(MANAGED_ERROR_CODE.EVENT_CURSOR_EXPIRED);
    expect(expired.details).toEqual({ oldestCursor: equalityCursor });
  });

  it("distinguishes malformed, future, and previous-boot cursors in fixed order", () => {
    // Given
    const journal = new ManagedEventJournal({
      bootId: EVENT_BOOT_ID,
      capacity: 2,
      clock: new EventClock(),
    });
    journal.append(sessionEvent(1));
    const future = encodeEventCursor({
      v: 1,
      b: EVENT_BOOT_ID,
      s: CanonicalCursorSequenceSchema.parse("2"),
    });
    const previousBoot = encodeEventCursor({
      v: 1,
      b: OTHER_EVENT_BOOT_ID,
      s: CanonicalCursorSequenceSchema.parse("1"),
    });

    // When
    const malformedError = managedEventError(() =>
      journal.read({ cursor: "not+a+cursor", pageSize: 10 }),
    );
    const futureError = managedEventError(() =>
      journal.read({ cursor: future, pageSize: 10 }),
    );
    const restartedError = managedEventError(() =>
      journal.read({ cursor: previousBoot, pageSize: 10 }),
    );

    // Then
    expect([
      malformedError.code,
      futureError.code,
      restartedError.code,
    ]).toEqual([
      MANAGED_ERROR_CODE.INVALID_CURSOR,
      MANAGED_ERROR_CODE.INVALID_CURSOR,
      MANAGED_ERROR_CODE.EVENT_CURSOR_RESTARTED,
    ]);
  });
});
