import {
  ADMISSION_STATE,
  AdmissionSchema,
  LIST_RESOURCE_KIND,
  SESSION_STATE,
  SessionSchema,
  WORKER_STATE,
  WorkerSchema,
  canonicalJson,
} from "@happycastle/steel-managed-shared";
import { assertNever } from "../../domain/exhaustive.js";
import type {
  ManagedListCreateInput,
  StoredListSnapshot,
} from "./list-types.js";

const WORKER_STATE_ORDER = Object.freeze(Object.values(WORKER_STATE));
const SESSION_STATE_ORDER = Object.freeze(Object.values(SESSION_STATE));
const ADMISSION_STATE_ORDER = Object.freeze(Object.values(ADMISSION_STATE));

export type ProjectedList = Readonly<{
  bytes: number;
  serializedItems: readonly string[];
  states: readonly string[];
}>;

export function projectManagedList(
  input: ManagedListCreateInput,
): ProjectedList {
  switch (input.kind) {
    case LIST_RESOURCE_KIND.WORKERS: {
      const states = WORKER_STATE_ORDER.filter((state) =>
        input.states.includes(state),
      );
      const items = input.items
        .map((item) => WorkerSchema.parse(item))
        .filter((item) => states.length === 0 || states.includes(item.state))
        .sort((left, right) => left.workerId.localeCompare(right.workerId));
      return serialize(items, states);
    }
    case LIST_RESOURCE_KIND.SESSIONS: {
      const states = SESSION_STATE_ORDER.filter((state) =>
        input.states.includes(state),
      );
      const items = input.items
        .map((item) => SessionSchema.parse(item))
        .filter((item) => states.length === 0 || states.includes(item.state))
        .sort(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) ||
            left.sessionId.localeCompare(right.sessionId),
        );
      return serialize(items, states);
    }
    case LIST_RESOURCE_KIND.QUEUE: {
      const states = ADMISSION_STATE_ORDER.filter((state) =>
        input.states.includes(state),
      );
      const items = input.items
        .map((item) => AdmissionSchema.parse(item))
        .filter((item) => states.length === 0 || states.includes(item.state))
        .sort(
          (left, right) =>
            (left.position ?? Number.MAX_SAFE_INTEGER) -
              (right.position ?? Number.MAX_SAFE_INTEGER) ||
            left.admissionId.localeCompare(right.admissionId),
        );
      return serialize(items, states);
    }
    default:
      return assertNever(input);
  }
}

export function normalizeContinuationStates(
  input: ManagedListCreateInput["kind"],
  states: readonly string[],
): readonly string[] {
  switch (input) {
    case LIST_RESOURCE_KIND.WORKERS:
      return WORKER_STATE_ORDER.filter((state) => states.includes(state));
    case LIST_RESOURCE_KIND.SESSIONS:
      return SESSION_STATE_ORDER.filter((state) => states.includes(state));
    case LIST_RESOURCE_KIND.QUEUE:
      return ADMISSION_STATE_ORDER.filter((state) => states.includes(state));
    default:
      return assertNever(input);
  }
}

export function materializeSnapshotItems(
  record: StoredListSnapshot,
  offset: number,
  pageSize: number,
) {
  const page = record.serializedItems
    .slice(offset, offset + pageSize)
    .map((item) => JSON.parse(item));
  switch (record.kind) {
    case LIST_RESOURCE_KIND.WORKERS:
      return {
        kind: record.kind,
        items: page.map((item) => WorkerSchema.parse(item)),
      } as const;
    case LIST_RESOURCE_KIND.SESSIONS:
      return {
        kind: record.kind,
        items: page.map((item) => SessionSchema.parse(item)),
      } as const;
    case LIST_RESOURCE_KIND.QUEUE:
      return {
        kind: record.kind,
        items: page.map((item) => AdmissionSchema.parse(item)),
      } as const;
    default:
      return assertNever(record.kind);
  }
}

function serialize(
  items: readonly unknown[],
  states: readonly string[],
): ProjectedList {
  const serializedItems = items.map((item) => canonicalJson(item));
  const bytes = new TextEncoder().encode(
    `[${serializedItems.join(",")}]`,
  ).byteLength;
  return { bytes, serializedItems, states };
}
