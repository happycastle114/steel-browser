import { describe, expect, it } from "vitest";
import {
  BootIdSchema,
  LIST_RESOURCE_KIND,
  MANAGED_ERROR_CODE,
  SESSION_STATE,
  SafeCountSchema,
  SessionSchema,
  Sha256Schema,
  SnapshotIdSchema,
  decodeListCursor,
  encodeListCursor,
} from "@happycastle/steel-managed-shared";
import {
  ManagedListSnapshotStore,
  ManagedOperationsError,
} from "../src/api/operations/index.js";

class ListCursorTestError extends Error {
  public override readonly name = "ListCursorTestError";
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
const OTHER_PRINCIPAL_DIGEST = Sha256Schema.parse("b".repeat(64));

function createStore() {
  return new ManagedListSnapshotStore({
    bootId: BOOT_ID,
    clock: { now: () => 1_000 },
    maxBytes: 1_000_000,
    maxSnapshots: 100,
    ttlMs: 30_000,
  });
}

function managedError(action: () => unknown): ManagedOperationsError {
  try {
    action();
  } catch (error) {
    if (error instanceof ManagedOperationsError) return error;
    throw error;
  }
  throw new ListCursorTestError("managed operation did not fail");
}

describe("ManagedListSnapshotStore cursor security", () => {
  it("returns the same expiry response for another principal and a missing snapshot", () => {
    // Given
    const store = createStore();
    const first = store.create({
      kind: LIST_RESOURCE_KIND.SESSIONS,
      items: [session(1)],
      pageSize: 1,
      principalDigest: PRINCIPAL_DIGEST,
      states: [],
    });
    const payload = decodeListCursor(first.value.page.snapshotCursor);
    const missingCursor = encodeListCursor({
      ...payload,
      n: SnapshotIdSchema.parse(uuid(999)),
    });

    // When
    const crossPrincipal = managedError(() =>
      store.continue({
        kind: LIST_RESOURCE_KIND.SESSIONS,
        cursor: first.value.page.snapshotCursor,
        principalDigest: OTHER_PRINCIPAL_DIGEST,
      }),
    );
    const missing = managedError(() =>
      store.continue({
        kind: LIST_RESOURCE_KIND.SESSIONS,
        cursor: missingCursor,
        principalDigest: PRINCIPAL_DIGEST,
      }),
    );

    // Then
    expect({
      code: crossPrincipal.code,
      message: crossPrincipal.message,
      status: crossPrincipal.status,
    }).toEqual({
      code: missing.code,
      message: missing.message,
      status: missing.status,
    });
  });

  it("rejects fabricated offsets and changed continuation filters", () => {
    // Given
    const store = createStore();
    const first = store.create({
      kind: LIST_RESOURCE_KIND.SESSIONS,
      items: [session(1), session(2), session(3)],
      pageSize: 2,
      principalDigest: PRINCIPAL_DIGEST,
      states: [SESSION_STATE.LIVE],
    });
    const payload = decodeListCursor(first.value.page.snapshotCursor);
    const interior = encodeListCursor({
      ...payload,
      o: SafeCountSchema.parse(1),
    });
    const future = encodeListCursor({
      ...payload,
      o: SafeCountSchema.parse(99),
    });

    // When
    const failures = [
      () =>
        store.continue({
          kind: LIST_RESOURCE_KIND.SESSIONS,
          cursor: interior,
          principalDigest: PRINCIPAL_DIGEST,
        }),
      () =>
        store.continue({
          kind: LIST_RESOURCE_KIND.SESSIONS,
          cursor: future,
          principalDigest: PRINCIPAL_DIGEST,
        }),
      () =>
        store.continue({
          kind: LIST_RESOURCE_KIND.SESSIONS,
          cursor: first.value.page.snapshotCursor,
          pageSize: 3,
          principalDigest: PRINCIPAL_DIGEST,
        }),
      () =>
        store.continue({
          kind: LIST_RESOURCE_KIND.SESSIONS,
          cursor: first.value.page.snapshotCursor,
          principalDigest: PRINCIPAL_DIGEST,
          states: [SESSION_STATE.FAILED],
        }),
    ].map((failure) => managedError(failure));

    // Then
    expect(failures.map(({ code }) => code)).toEqual(
      Array.from({ length: 4 }, () => MANAGED_ERROR_CODE.INVALID_CURSOR),
    );
  });
});
