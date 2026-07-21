import { describe, expect, it } from "vitest";
import {
  EVENT_TYPE,
  IsoTimeSchema,
  MANAGER_MODE,
  MANAGER_MODE_CAUSE,
  MANAGER_MODE_TRANSITION,
} from "@happycastle/steel-managed-shared";
import {
  ManagedEventJournal,
  ManagedEventSequenceExhaustedError,
} from "../src/api/operations/index.js";
import {
  EVENT_BOOT_ID,
  EventClock,
  sessionEvent,
} from "./managed-event-test-support.js";

describe("ManagedEventJournal boundaries", () => {
  it("preserves event sequence precision above the JSON safe-integer boundary", () => {
    // Given
    const journal = new ManagedEventJournal({
      bootId: EVENT_BOOT_ID,
      capacity: 2,
      clock: new EventClock(),
    });
    journal["sequence"] = 9_007_199_254_740_992n;

    // When
    const event = journal.append(sessionEvent(1));

    // Then
    expect(event.sequence).toBe("9007199254740993");
    expect(typeof event.sequence).toBe("string");
  });

  it("rejects impossible uint64 totals instead of wrapping the sequence", () => {
    // Given
    const journal = new ManagedEventJournal({
      bootId: EVENT_BOOT_ID,
      capacity: 2,
      clock: new EventClock(),
    });
    journal["sequence"] = 18_446_744_073_709_551_615n;

    // When
    const append = () => journal.append(sessionEvent(1));

    // Then
    expect(append).toThrow(ManagedEventSequenceExhaustedError);
  });

  it("validates drain and resume transition payloads with their cause fences", () => {
    // Given
    const journal = new ManagedEventJournal({
      bootId: EVENT_BOOT_ID,
      capacity: 2,
      clock: new EventClock(),
    });
    const drainEnteredAt = IsoTimeSchema.parse(new Date(1_000).toISOString());
    const deadlineAt = IsoTimeSchema.parse(new Date(30_000).toISOString());
    const safeAt = IsoTimeSchema.parse(new Date(61_000).toISOString());

    // When
    const drain = journal.append({
      type: EVENT_TYPE.MANAGER_MODE_CHANGED,
      payload: {
        transition: MANAGER_MODE_TRANSITION.DRAIN,
        from: MANAGER_MODE.SERVING,
        to: MANAGER_MODE.DRAINING,
        cause: MANAGER_MODE_CAUSE.CUTOVER,
        deadlineAt,
        drainEnteredAt,
        safeAt,
      },
    });
    const resume = journal.append({
      type: EVENT_TYPE.MANAGER_MODE_CHANGED,
      payload: {
        transition: MANAGER_MODE_TRANSITION.RESUME,
        from: MANAGER_MODE.DRAINING,
        to: MANAGER_MODE.SERVING,
        cause: MANAGER_MODE_CAUSE.ROLLBACK,
        previousSafeAt: safeAt,
        resumedAt: IsoTimeSchema.parse(new Date(62_000).toISOString()),
      },
    });

    // Then
    expect(drain.payload).toMatchObject({
      transition: MANAGER_MODE_TRANSITION.DRAIN,
      cause: MANAGER_MODE_CAUSE.CUTOVER,
      deadlineAt,
      safeAt,
    });
    expect(resume.payload).toMatchObject({
      transition: MANAGER_MODE_TRANSITION.RESUME,
      cause: MANAGER_MODE_CAUSE.ROLLBACK,
      previousSafeAt: safeAt,
    });
    expect([drain.sequence, resume.sequence]).toEqual(["1", "2"]);
  });
});
