import { describe, expect, it } from "vitest";
import {
  ADMISSION_STATE,
  AdmissionSchema,
  BootIdSchema,
  LIST_RESOURCE_KIND,
  SESSION_STATE,
  SessionSchema,
  Sha256Schema,
  WORKER_STATE,
  WorkerSchema,
} from "@happycastle/steel-managed-shared";
import { ManagedListSnapshotStore } from "../src/api/operations/index.js";

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

const PRINCIPAL_DIGEST = Sha256Schema.parse("a".repeat(64));

class ListOrderingTestError extends Error {
  public override readonly name = "ListOrderingTestError";
}

function store() {
  return new ManagedListSnapshotStore({
    bootId: BootIdSchema.parse(uuid(90)),
    clock: { now: () => 1_000 },
    maxBytes: 1_000_000,
    maxSnapshots: 100,
    ttlMs: 30_000,
  });
}

describe("managed list canonical ordering", () => {
  it("orders workers by worker ID", () => {
    // Given
    const workers = ["worker-02", "worker-00", "worker-01"].map(
      (workerId, index) =>
        WorkerSchema.parse({
          workerId,
          instanceId: uuid(index + 1),
          state: WORKER_STATE.IDLE,
          lastSeenAt: new Date(1).toISOString(),
          stateChangedAt: new Date(1).toISOString(),
        }),
    );

    // When
    const page = store().create({
      kind: LIST_RESOURCE_KIND.WORKERS,
      items: workers,
      pageSize: 100,
      principalDigest: PRINCIPAL_DIGEST,
      states: [],
    });

    // Then
    if (page.kind !== LIST_RESOURCE_KIND.WORKERS) {
      throw new ListOrderingTestError("unexpected worker list kind");
    }
    expect(page.value.items.map(({ workerId }) => workerId)).toEqual([
      "worker-00",
      "worker-01",
      "worker-02",
    ]);
  });

  it("orders sessions by newest creation then session ID", () => {
    // Given
    const sessions = [
      SessionSchema.parse({
        sessionId: uuid(3),
        state: SESSION_STATE.LIVE,
        createdAt: new Date(2).toISOString(),
        startedAt: new Date(3).toISOString(),
      }),
      SessionSchema.parse({
        sessionId: uuid(2),
        state: SESSION_STATE.LIVE,
        createdAt: new Date(2).toISOString(),
        startedAt: new Date(3).toISOString(),
      }),
      SessionSchema.parse({
        sessionId: uuid(1),
        state: SESSION_STATE.LIVE,
        createdAt: new Date(1).toISOString(),
        startedAt: new Date(2).toISOString(),
      }),
    ];

    // When
    const page = store().create({
      kind: LIST_RESOURCE_KIND.SESSIONS,
      items: sessions,
      pageSize: 100,
      principalDigest: PRINCIPAL_DIGEST,
      states: [],
    });

    // Then
    if (page.kind !== LIST_RESOURCE_KIND.SESSIONS) {
      throw new ListOrderingTestError("unexpected session list kind");
    }
    expect(page.value.items.map(({ sessionId }) => sessionId)).toEqual([
      uuid(2),
      uuid(3),
      uuid(1),
    ]);
  });

  it("orders queue positions before unpositioned terminal admissions", () => {
    // Given
    const admissions = [
      AdmissionSchema.parse({
        admissionId: uuid(3),
        state: ADMISSION_STATE.CANCELLED,
        createdAt: new Date(1).toISOString(),
        expiresAt: new Date(2).toISOString(),
        updatedAt: new Date(2).toISOString(),
      }),
      AdmissionSchema.parse({
        admissionId: uuid(2),
        state: ADMISSION_STATE.QUEUED,
        position: 2,
        createdAt: new Date(1).toISOString(),
        expiresAt: new Date(2).toISOString(),
        updatedAt: new Date(1).toISOString(),
      }),
      AdmissionSchema.parse({
        admissionId: uuid(1),
        state: ADMISSION_STATE.QUEUED,
        position: 1,
        createdAt: new Date(1).toISOString(),
        expiresAt: new Date(2).toISOString(),
        updatedAt: new Date(1).toISOString(),
      }),
    ];

    // When
    const page = store().create({
      kind: LIST_RESOURCE_KIND.QUEUE,
      items: admissions,
      pageSize: 100,
      principalDigest: PRINCIPAL_DIGEST,
      states: [],
    });

    // Then
    if (page.kind !== LIST_RESOURCE_KIND.QUEUE) {
      throw new ListOrderingTestError("unexpected queue list kind");
    }
    expect(page.value.items.map(({ admissionId }) => admissionId)).toEqual([
      uuid(1),
      uuid(2),
      uuid(3),
    ]);
  });

  it("normalizes reordered and duplicate continuation state filters", () => {
    // Given
    const snapshots = store();
    const first = snapshots.create({
      kind: LIST_RESOURCE_KIND.SESSIONS,
      items: [],
      pageSize: 1,
      principalDigest: PRINCIPAL_DIGEST,
      states: [SESSION_STATE.LIVE, SESSION_STATE.STARTING],
    });

    // When
    const replay = snapshots.continue({
      kind: LIST_RESOURCE_KIND.SESSIONS,
      cursor: first.value.page.snapshotCursor,
      pageSize: 1,
      principalDigest: PRINCIPAL_DIGEST,
      states: [SESSION_STATE.STARTING, SESSION_STATE.LIVE, SESSION_STATE.LIVE],
    });

    // Then
    expect(replay.value).toEqual(first.value);
  });
});
