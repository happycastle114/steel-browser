import { CreateReplayRecordSchema } from "@happycastle/steel-managed-shared"
import {
  CREATE_JOURNAL_POLICY,
  CREATE_JOURNAL_STATE,
  type CreateReplay,
  type CreateReplayRecord,
} from "./create-journal-contract.js"

export const CREATE_COMPLETION_RESULT = {
  COMPLETED: "COMPLETED",
  UNCHANGED: "UNCHANGED",
  UNCERTAIN: "UNCERTAIN",
} as const

type CompletionState =
  | typeof CREATE_JOURNAL_STATE.LIVE
  | typeof CREATE_JOURNAL_STATE.FAILED_TERMINAL

export type CreateCompletionDecision =
  | { readonly kind: typeof CREATE_COMPLETION_RESULT.UNCHANGED }
  | {
    readonly kind:
      | typeof CREATE_COMPLETION_RESULT.COMPLETED
      | typeof CREATE_COMPLETION_RESULT.UNCERTAIN
    readonly record: CreateReplayRecord
  }

export function isTerminalJournalState(
  state: CreateReplayRecord["state"],
): boolean {
  return state === CREATE_JOURNAL_STATE.RELEASED_TERMINAL ||
    state === CREATE_JOURNAL_STATE.FAILED_TERMINAL
}

export function transitionCreateReplayRecord(
  record: CreateReplayRecord,
  state: CreateReplayRecord["state"],
  now: number,
  replay?: CreateReplay,
  upstreamSessionId?: string,
  ttlMs: number = CREATE_JOURNAL_POLICY.TTL_MS,
): CreateReplayRecord {
  return CreateReplayRecordSchema.parse({
    ...record,
    expiresAt: isTerminalJournalState(state)
      ? new Date(now + ttlMs).toISOString()
      : record.expiresAt,
    state,
    updatedAt: new Date(now).toISOString(),
    ...(replay === undefined ? {} : { replay }),
    ...(upstreamSessionId === undefined ? {} : { upstreamSessionId }),
  })
}

export function uncertainCreateReplayRecord(
  record: CreateReplayRecord,
  now: number,
): CreateReplayRecord {
  return CreateReplayRecordSchema.parse({
    expiresAt: record.expiresAt,
    ownerSha256: record.ownerSha256,
    requestSha256: record.requestSha256,
    state: CREATE_JOURNAL_STATE.UNCERTAIN,
    token: record.token,
    updatedAt: new Date(now).toISOString(),
  })
}

export function decideCreateCompletion(
  current: CreateReplayRecord,
  state: CompletionState,
  replay: CreateReplay,
  upstreamSessionId: string | undefined,
  now: number,
  ttlMs: number,
  recordBytes: number,
): CreateCompletionDecision {
  if (
    current.state === CREATE_JOURNAL_STATE.UNCERTAIN &&
    state !== CREATE_JOURNAL_STATE.LIVE
  ) {
    return { kind: CREATE_COMPLETION_RESULT.UNCHANGED }
  }
  const completed = transitionCreateReplayRecord(
    current,
    state,
    now,
    replay,
    upstreamSessionId,
    ttlMs,
  )
  if (Buffer.byteLength(JSON.stringify(completed)) <= recordBytes) {
    return { kind: CREATE_COMPLETION_RESULT.COMPLETED, record: completed }
  }
  return {
    kind: CREATE_COMPLETION_RESULT.UNCERTAIN,
    record: uncertainCreateReplayRecord(current, now),
  }
}

export function reconcileCreateReplayRecords(
  records: ReadonlyMap<string, CreateReplayRecord>,
  sessionId: string | null,
  now: () => number,
  ttlMs: number,
): Map<string, CreateReplayRecord> | undefined {
  const next = new Map(records)
  let mutated = false
  for (const [token, record] of next) {
    if (sessionId === null && record.state === CREATE_JOURNAL_STATE.LIVE) {
      next.set(token, transitionCreateReplayRecord(
        record,
        CREATE_JOURNAL_STATE.RELEASED_TERMINAL,
        now(),
        undefined,
        undefined,
        ttlMs,
      ))
      mutated = true
    } else if (
      sessionId !== null &&
      (record.state === CREATE_JOURNAL_STATE.ACCEPTED ||
        record.state === CREATE_JOURNAL_STATE.UPSTREAM_PENDING ||
        record.state === CREATE_JOURNAL_STATE.UNCERTAIN ||
        (record.state === CREATE_JOURNAL_STATE.LIVE &&
          record.upstreamSessionId !== sessionId))
    ) {
      next.set(token, uncertainCreateReplayRecord(record, now()))
      mutated = true
    }
  }
  return mutated ? next : undefined
}
