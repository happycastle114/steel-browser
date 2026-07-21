import { describe, expect, it } from "vitest";
import {
  BootIdSchema,
  CONTROL_PLANE_API_VERSION,
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
} from "../src/api/operations/index.js";

class SnapshotBoundaryTestError extends Error {
  public override readonly name = "SnapshotBoundaryTestError";
}

function session() {
  return SessionSchema.parse({
    sessionId: "00000000-0000-4000-8000-000000000001",
    state: SESSION_STATE.LIVE,
    createdAt: "1970-01-01T00:00:00.001Z",
    startedAt: "1970-01-01T00:00:00.002Z",
  });
}

const BOOT_ID = BootIdSchema.parse("00000000-0000-4000-8000-000000000090");
const OTHER_BOOT_ID = BootIdSchema.parse(
  "00000000-0000-4000-8000-000000000091",
);
const PRINCIPAL_DIGEST = Sha256Schema.parse("a".repeat(64));

function createStore(
  input: Readonly<{ bootId?: typeof BOOT_ID; maxBytes?: number }> = {},
) {
  return new ManagedListSnapshotStore({
    bootId: input.bootId ?? BOOT_ID,
    clock: { now: () => 1_000 },
    maxBytes: input.maxBytes ?? 1_000_000,
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
  throw new SnapshotBoundaryTestError("snapshot operation did not fail");
}

function createOne(store: ManagedListSnapshotStore) {
  return store.create({
    kind: LIST_RESOURCE_KIND.SESSIONS,
    items: [session()],
    pageSize: 1,
    principalDigest: PRINCIPAL_DIGEST,
    states: [],
  });
}

describe("ManagedListSnapshotStore boundaries", () => {
  it("accepts the exact serialized-byte boundary and rejects one byte below it", () => {
    // Given
    const items = [session()];
    const exactBytes = new TextEncoder().encode(
      canonicalJson(items),
    ).byteLength;

    // When
    const accepted = createOne(createStore({ maxBytes: exactBytes }));
    const rejected = managedError(() =>
      createOne(createStore({ maxBytes: exactBytes - 1 })),
    );

    // Then
    expect(accepted.value.apiVersion).toBe(CONTROL_PLANE_API_VERSION);
    expect(rejected.code).toBe(MANAGED_ERROR_CODE.MANAGED_SNAPSHOT_CAPACITY);
    expect(rejected.retryAfterSeconds).toBe(1);
  });

  it("rejects a cursor from a previous manager boot before snapshot lookup", () => {
    // Given
    const first = createOne(createStore());
    const restartedStore = createStore({ bootId: OTHER_BOOT_ID });

    // When
    const restarted = managedError(() =>
      restartedStore.continue({
        kind: LIST_RESOURCE_KIND.SESSIONS,
        cursor: first.value.page.snapshotCursor,
        principalDigest: PRINCIPAL_DIGEST,
      }),
    );

    // Then
    expect(restarted.code).toBe(MANAGED_ERROR_CODE.LIST_CURSOR_RESTARTED);
  });
});
