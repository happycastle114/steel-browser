import { createHash, randomUUID } from "node:crypto";
import {
  CONTROL_PLANE_API_VERSION,
  LIST_RESOURCE_KIND,
  MANAGED_ERROR_CODE,
  SafeCountSchema,
  Sha256Schema,
  SnapshotIdSchema,
  canonicalJson,
  decodeListCursor,
  encodeListCursor,
} from "@happycastle/steel-managed-shared";
import {
  ManagedOperationsConfigurationError,
  ManagedOperationsError,
} from "./errors.js";
import {
  materializeSnapshotItems,
  normalizeContinuationStates,
  projectManagedList,
} from "./list-projection.js";
import type {
  ManagedListContinueInput,
  ManagedListCreateInput,
  ManagedListResult,
  ManagedListSnapshotStoreOptions,
  StoredListSnapshot,
} from "./list-types.js";

export class ManagedListSnapshotStore {
  private readonly records = new Map<string, StoredListSnapshot>();
  private reservedBytes = 0;

  public constructor(
    private readonly options: ManagedListSnapshotStoreOptions,
  ) {
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1) {
      throw new ManagedOperationsConfigurationError(
        "snapshot byte capacity must be a positive safe integer",
      );
    }
    if (
      !Number.isSafeInteger(options.maxSnapshots) ||
      options.maxSnapshots < 1
    ) {
      throw new ManagedOperationsConfigurationError(
        "snapshot count capacity must be a positive safe integer",
      );
    }
    if (!Number.isSafeInteger(options.ttlMs) || options.ttlMs < 1) {
      throw new ManagedOperationsConfigurationError(
        "snapshot TTL must be a positive safe integer",
      );
    }
  }

  public create(input: ManagedListCreateInput): ManagedListResult {
    this.pruneExpired();
    const projection = projectManagedList(input);
    if (
      this.records.size + 1 > this.options.maxSnapshots ||
      this.reservedBytes + projection.bytes > this.options.maxBytes
    ) {
      throw snapshotError();
    }
    const snapshotId = SnapshotIdSchema.parse(randomUUID());
    if (this.records.has(snapshotId)) throw snapshotError();
    const filterSha256 = filterHash(
      input.kind,
      input.pageSize,
      projection.states,
    );
    const record = {
      bootId: this.options.bootId,
      bytes: projection.bytes,
      expiresAtMs: this.options.clock.now() + this.options.ttlMs,
      filterSha256,
      issuedOffsets: new Set([SafeCountSchema.parse(0)]),
      kind: input.kind,
      pageSize: input.pageSize,
      principalDigest: input.principalDigest,
      serializedItems: projection.serializedItems,
      snapshotId,
      states: projection.states,
    } satisfies StoredListSnapshot;
    this.records.set(snapshotId, record);
    this.reservedBytes += projection.bytes;
    return this.page(record, 0);
  }

  public continue(input: ManagedListContinueInput): ManagedListResult {
    const cursor = decodeCursor(input.cursor);
    if (cursor.k !== input.kind) throw invalidCursor();
    if (cursor.b !== this.options.bootId) {
      throw new ManagedOperationsError({
        code: MANAGED_ERROR_CODE.LIST_CURSOR_RESTARTED,
        message: "List cursor belongs to another manager boot",
      });
    }
    this.pruneExpired();
    const record = this.records.get(cursor.n);
    if (
      record === undefined ||
      record.principalDigest !== input.principalDigest
    )
      throw expiredCursor();
    if (record.filterSha256 !== cursor.f) throw invalidCursor();
    const states =
      input.states === undefined
        ? record.states
        : normalizeContinuationStates(input.kind, input.states);
    const pageSize = input.pageSize ?? record.pageSize;
    if (filterHash(input.kind, pageSize, states) !== record.filterSha256)
      throw invalidCursor();
    if (!record.issuedOffsets.has(cursor.o)) throw invalidCursor();
    return this.page(record, cursor.o);
  }

  private page(record: StoredListSnapshot, offset: number): ManagedListResult {
    const materialized = materializeSnapshotItems(
      record,
      offset,
      record.pageSize,
    );
    const nextOffset = offset + materialized.items.length;
    const hasMore = nextOffset < record.serializedItems.length;
    const snapshotCursor = encodeListCursor({
      v: 1,
      b: record.bootId,
      k: record.kind,
      f: record.filterSha256,
      n: record.snapshotId,
      o: SafeCountSchema.parse(0),
    });
    const basePage = { pageSize: record.pageSize, snapshotCursor, hasMore };
    const page = hasMore
      ? { ...basePage, nextCursor: this.issueCursor(record, nextOffset) }
      : basePage;
    switch (materialized.kind) {
      case LIST_RESOURCE_KIND.WORKERS:
        return {
          kind: materialized.kind,
          value: {
            apiVersion: CONTROL_PLANE_API_VERSION,
            items: materialized.items,
            page,
          },
        };
      case LIST_RESOURCE_KIND.SESSIONS:
        return {
          kind: materialized.kind,
          value: {
            apiVersion: CONTROL_PLANE_API_VERSION,
            items: materialized.items,
            page,
          },
        };
      case LIST_RESOURCE_KIND.QUEUE:
        return {
          kind: materialized.kind,
          value: {
            apiVersion: CONTROL_PLANE_API_VERSION,
            items: materialized.items,
            page,
          },
        };
    }
  }

  private issueCursor(record: StoredListSnapshot, offset: number) {
    const safeOffset = SafeCountSchema.parse(offset);
    record.issuedOffsets.add(safeOffset);
    return encodeListCursor({
      v: 1,
      b: record.bootId,
      k: record.kind,
      f: record.filterSha256,
      n: record.snapshotId,
      o: safeOffset,
    });
  }

  private pruneExpired(): void {
    const now = this.options.clock.now();
    for (const [snapshotId, record] of this.records) {
      if (record.expiresAtMs <= now) {
        this.records.delete(snapshotId);
        this.reservedBytes -= record.bytes;
      }
    }
  }
}

function filterHash(
  kind: ManagedListCreateInput["kind"],
  pageSize: number,
  states: readonly string[],
) {
  return Sha256Schema.parse(
    createHash("sha256")
      .update(canonicalJson({ kind, pageSize, states }))
      .digest("hex"),
  );
}

function decodeCursor(cursor: string) {
  try {
    return decodeListCursor(cursor);
  } catch {
    throw invalidCursor();
  }
}

function invalidCursor() {
  return new ManagedOperationsError({
    code: MANAGED_ERROR_CODE.INVALID_CURSOR,
    message: "Invalid list cursor",
  });
}

function expiredCursor() {
  return new ManagedOperationsError({
    code: MANAGED_ERROR_CODE.LIST_CURSOR_EXPIRED,
    message: "List cursor expired",
  });
}

function snapshotError() {
  return new ManagedOperationsError({
    code: MANAGED_ERROR_CODE.MANAGED_SNAPSHOT_CAPACITY,
    message: "Managed list snapshot capacity exhausted",
    retryAfterSeconds: 1,
  });
}
