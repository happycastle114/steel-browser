import { describe, expect, it } from "vitest";
import {
  BootIdSchema,
  LIST_RESOURCE_KIND,
  MANAGED_ERROR_CODE,
  SESSION_STATE,
  SessionSchema,
  Sha256Schema,
  canonicalJson,
} from "@happycastle/steel-managed-shared";
import {
  ManagedListSnapshotStore,
  ManagedOperationsError,
  type ManagedOperationsClock,
} from "../src/api/operations/index.js";

class MutableClock implements ManagedOperationsClock {
  public constructor(private currentMilliseconds = 1_000) {}

  public now(): number {
    return this.currentMilliseconds;
  }

  public advance(milliseconds: number): void {
    this.currentMilliseconds += milliseconds;
  }
}

class ExpectedManagedError extends Error {
  public override readonly name = "ExpectedManagedError";
}

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

function session(sequence: number) {
  return SessionSchema.parse({
    sessionId: uuid(sequence),
    state: SESSION_STATE.LIVE,
    createdAt: new Date(sequence).toISOString(),
    startedAt: new Date(sequence + 1).toISOString(),
  });
}

const BOOT_ID = BootIdSchema.parse(uuid(90));
const PRINCIPAL_DIGEST = Sha256Schema.parse("a".repeat(64));

function managedError(action: () => unknown): ManagedOperationsError {
  try {
    action();
  } catch (error) {
    if (error instanceof ManagedOperationsError) return error;
    throw error;
  }
  throw new ExpectedManagedError("managed operation did not fail");
}

function createStore(
  input: Readonly<{ clock?: MutableClock; ttlMs?: number }> = {},
) {
  return new ManagedListSnapshotStore({
    bootId: BOOT_ID,
    clock: input.clock ?? new MutableClock(),
    maxBytes: 1_000_000,
    maxSnapshots: 100,
    ttlMs: input.ttlMs ?? 30_000,
  });
}

describe("ManagedListSnapshotStore", () => {
  it("serves later pages from immutable projections after live objects mutate", () => {
    // Given
    const mutableFirst = { ...session(1), failureCode: "ORIGINAL" };
    const store = createStore();
    const first = store.create({
      kind: LIST_RESOURCE_KIND.SESSIONS,
      items: [mutableFirst, session(2), session(3)],
      pageSize: 2,
      principalDigest: PRINCIPAL_DIGEST,
      states: [],
    });
    if (first.kind !== LIST_RESOURCE_KIND.SESSIONS) {
      throw new ExpectedManagedError("unexpected list kind");
    }
    const nextCursor = first.value.page.nextCursor;
    if (nextCursor === undefined) {
      throw new ExpectedManagedError("missing next cursor");
    }

    // When
    mutableFirst.failureCode = "MUTATED";
    const terminal = store.continue({
      kind: LIST_RESOURCE_KIND.SESSIONS,
      cursor: nextCursor,
      principalDigest: PRINCIPAL_DIGEST,
    });
    if (terminal.kind !== LIST_RESOURCE_KIND.SESSIONS) {
      throw new ExpectedManagedError("unexpected list kind");
    }

    // Then
    expect(
      [...first.value.items, ...terminal.value.items].map(
        ({ sessionId }) => sessionId,
      ),
    ).toEqual([uuid(3), uuid(2), uuid(1)]);
    expect(terminal.value.items[0]?.failureCode).toBe("ORIGINAL");
    expect(terminal.value.page.snapshotCursor).toBe(
      first.value.page.snapshotCursor,
    );
    expect(terminal.value.page).not.toHaveProperty("nextCursor");
  });

  it("replays byte-identically without extending absolute expiry", () => {
    // Given
    const clock = new MutableClock();
    const store = createStore({ clock, ttlMs: 100 });
    const first = store.create({
      kind: LIST_RESOURCE_KIND.SESSIONS,
      items: [session(1), session(2)],
      pageSize: 1,
      principalDigest: PRINCIPAL_DIGEST,
      states: [SESSION_STATE.LIVE],
    });

    // When
    clock.advance(60);
    const replay = store.continue({
      kind: LIST_RESOURCE_KIND.SESSIONS,
      cursor: first.value.page.snapshotCursor,
      pageSize: 1,
      principalDigest: PRINCIPAL_DIGEST,
      states: [SESSION_STATE.LIVE],
    });
    clock.advance(41);
    const expired = managedError(() =>
      store.continue({
        kind: LIST_RESOURCE_KIND.SESSIONS,
        cursor: first.value.page.snapshotCursor,
        principalDigest: PRINCIPAL_DIGEST,
      }),
    );

    // Then
    expect(canonicalJson(replay.value)).toBe(canonicalJson(first.value));
    expect(expired.code).toBe(MANAGED_ERROR_CODE.LIST_CURSOR_EXPIRED);
  });
});
