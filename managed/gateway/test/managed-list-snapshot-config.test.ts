import { describe, expect, it } from "vitest";
import {
  LIST_RESOURCE_KIND,
  MANAGED_ERROR_CODE,
  BootIdSchema,
  Sha256Schema,
  decodeListCursor,
} from "@happycastle/steel-managed-shared";
import {
  ManagedListSnapshotStore,
  ManagedOperationsConfigurationError,
  ManagedOperationsError,
} from "../src/api/operations/index.js";

const BOOT_ID = BootIdSchema.parse("00000000-0000-4000-8000-000000000090");
const PRINCIPAL_DIGEST = Sha256Schema.parse("a".repeat(64));

function store() {
  return new ManagedListSnapshotStore({
    bootId: BOOT_ID,
    clock: { now: () => 1_000 },
    maxBytes: 1_000,
    maxSnapshots: 2,
    ttlMs: 30_000,
  });
}

class SnapshotConfigTestError extends Error {
  public override readonly name = "SnapshotConfigTestError";
}

function managedError(action: () => unknown): ManagedOperationsError {
  try {
    action();
  } catch (error) {
    if (error instanceof ManagedOperationsError) return error;
    throw error;
  }
  throw new SnapshotConfigTestError("snapshot operation did not fail");
}

function createEmpty(snapshots: ManagedListSnapshotStore) {
  return snapshots.create({
    kind: LIST_RESOURCE_KIND.SESSIONS,
    items: [],
    pageSize: 1,
    principalDigest: PRINCIPAL_DIGEST,
    states: [],
  });
}

describe("ManagedListSnapshotStore configuration", () => {
  it.each([
    { maxBytes: 0, maxSnapshots: 1, ttlMs: 1 },
    { maxBytes: 1, maxSnapshots: 0, ttlMs: 1 },
    { maxBytes: 1, maxSnapshots: 1, ttlMs: 0 },
  ])("rejects non-positive snapshot bounds %#", (bounds) => {
    // Given / When
    const create = () =>
      new ManagedListSnapshotStore({
        ...bounds,
        bootId: BOOT_ID,
        clock: { now: () => 1_000 },
      });

    // Then
    expect(create).toThrow(ManagedOperationsConfigurationError);
  });

  it("allocates unrelated cryptographic UUID snapshot identities", () => {
    // Given
    const snapshots = store();

    // When
    const first = createEmpty(snapshots);
    const second = createEmpty(snapshots);

    // Then
    const firstId = decodeListCursor(first.value.page.snapshotCursor).n;
    const secondId = decodeListCursor(second.value.page.snapshotCursor).n;
    expect(firstId).not.toBe(secondId);
    expect(firstId).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("fails closed at count capacity and admits only after absolute expiry", () => {
    // Given
    let now = 1_000;
    const snapshots = new ManagedListSnapshotStore({
      bootId: BOOT_ID,
      clock: { now: () => now },
      maxBytes: 1_000,
      maxSnapshots: 1,
      ttlMs: 100,
    });
    createEmpty(snapshots);

    // When
    const full = managedError(() => createEmpty(snapshots));
    now += 100;
    const afterExpiry = createEmpty(snapshots);

    // Then
    expect(full.code).toBe(MANAGED_ERROR_CODE.MANAGED_SNAPSHOT_CAPACITY);
    expect(afterExpiry.value.items).toEqual([]);
  });
});
