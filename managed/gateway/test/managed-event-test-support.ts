import {
  BootIdSchema,
  EVENT_TYPE,
  SESSION_STATE,
  SessionIdSchema,
} from "@happycastle/steel-managed-shared";
import {
  ManagedOperationsError,
  type ManagedEventDraft,
  type ManagedOperationsClock,
} from "../src/api/operations/index.js";

export class EventClock implements ManagedOperationsClock {
  public constructor(private currentMilliseconds = 1_000) {}

  public now(): number {
    return this.currentMilliseconds;
  }

  public advance(milliseconds: number): void {
    this.currentMilliseconds += milliseconds;
  }
}

class ExpectedEventError extends Error {
  public override readonly name = "ExpectedEventError";
}

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

export const EVENT_BOOT_ID = BootIdSchema.parse(uuid(200));
export const OTHER_EVENT_BOOT_ID = BootIdSchema.parse(uuid(201));

export function sessionEvent(sequence: number): ManagedEventDraft {
  return {
    type: EVENT_TYPE.SESSION_STATE_CHANGED,
    sessionId: SessionIdSchema.parse(uuid(sequence)),
    payload: { from: SESSION_STATE.QUEUED, to: SESSION_STATE.STARTING },
  };
}

export function managedEventError(
  action: () => unknown,
): ManagedOperationsError {
  try {
    action();
  } catch (error) {
    if (error instanceof ManagedOperationsError) return error;
    throw error;
  }
  throw new ExpectedEventError("managed event operation did not fail");
}
