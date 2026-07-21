import type {
  Admission,
  AdmissionState,
  BootId,
  OpaqueCursor,
  SafeCount,
  Session,
  SessionState,
  Sha256,
  SnapshotId,
  Worker,
  WorkerState,
} from "@happycastle/steel-managed-shared";
import {
  CONTROL_PLANE_API_VERSION,
  LIST_RESOURCE_KIND,
} from "@happycastle/steel-managed-shared";

export interface ManagedOperationsClock {
  now(): number;
}

export type ManagedListPage = Readonly<{
  pageSize: number;
  nextCursor?: OpaqueCursor;
  snapshotCursor: OpaqueCursor;
  hasMore: boolean;
}>;

export type ManagedListValue<Item> = Readonly<{
  apiVersion: typeof CONTROL_PLANE_API_VERSION;
  items: readonly Item[];
  page: ManagedListPage;
}>;

export type ManagedListResult =
  | Readonly<{
      kind: typeof LIST_RESOURCE_KIND.WORKERS;
      value: ManagedListValue<Worker>;
    }>
  | Readonly<{
      kind: typeof LIST_RESOURCE_KIND.SESSIONS;
      value: ManagedListValue<Session>;
    }>
  | Readonly<{
      kind: typeof LIST_RESOURCE_KIND.QUEUE;
      value: ManagedListValue<Admission>;
    }>;

export type ManagedListCreateInput =
  | Readonly<{
      kind: typeof LIST_RESOURCE_KIND.WORKERS;
      items: readonly Worker[];
      pageSize: number;
      principalDigest: Sha256;
      states: readonly WorkerState[];
    }>
  | Readonly<{
      kind: typeof LIST_RESOURCE_KIND.SESSIONS;
      items: readonly Session[];
      pageSize: number;
      principalDigest: Sha256;
      states: readonly SessionState[];
    }>
  | Readonly<{
      kind: typeof LIST_RESOURCE_KIND.QUEUE;
      items: readonly Admission[];
      pageSize: number;
      principalDigest: Sha256;
      states: readonly AdmissionState[];
    }>;

export type ManagedListContinueInput =
  | Readonly<{
      kind: typeof LIST_RESOURCE_KIND.WORKERS;
      cursor: string;
      pageSize?: number;
      principalDigest: Sha256;
      states?: readonly WorkerState[];
    }>
  | Readonly<{
      kind: typeof LIST_RESOURCE_KIND.SESSIONS;
      cursor: string;
      pageSize?: number;
      principalDigest: Sha256;
      states?: readonly SessionState[];
    }>
  | Readonly<{
      kind: typeof LIST_RESOURCE_KIND.QUEUE;
      cursor: string;
      pageSize?: number;
      principalDigest: Sha256;
      states?: readonly AdmissionState[];
    }>;

export type ManagedListSnapshotStoreOptions = Readonly<{
  bootId: BootId;
  clock: ManagedOperationsClock;
  maxBytes: number;
  maxSnapshots: number;
  ttlMs: number;
}>;

export type StoredListSnapshot = Readonly<{
  bootId: BootId;
  bytes: number;
  expiresAtMs: number;
  filterSha256: Sha256;
  issuedOffsets: Set<SafeCount>;
  kind: ManagedListCreateInput["kind"];
  pageSize: number;
  principalDigest: Sha256;
  serializedItems: readonly string[];
  snapshotId: SnapshotId;
  states: readonly string[];
}>;
