import { CreateReplayRecordSchema } from "@happycastle/steel-managed-shared"
import {
  CREATE_JOURNAL_STATE,
  JOURNAL_ACCEPT_RESULT,
  digestsEqual,
  type CreateReplayRecord,
  type JournalAcceptOutcome,
  type ManagedCreateContext,
} from "./create-journal-contract.js"
import { evictTerminalRecords } from "./create-journal-eviction.js"
import { isTerminalJournalState } from "./create-journal-records.js"

type AcceptanceLimits = Readonly<{
  maxRecords: number
  ttlMs: number
}>

export type CreateAcceptanceDecision = Readonly<{
  next?: ReadonlyMap<string, CreateReplayRecord>
  outcome: JournalAcceptOutcome
}>

export function decideCreateAcceptance(
  records: ReadonlyMap<string, CreateReplayRecord>,
  context: ManagedCreateContext,
  now: number,
  limits: AcceptanceLimits,
): CreateAcceptanceDecision {
  const next = new Map(records)
  evictTerminalRecords(next, now, limits.maxRecords, false)
  const existing = next.get(context.token)
  if (existing !== undefined) {
    const outcome = digestsEqual(existing.ownerSha256, context.ownerDigest) &&
      digestsEqual(existing.requestSha256, context.requestDigest)
      ? { kind: JOURNAL_ACCEPT_RESULT.DUPLICATE, record: existing } as const
      : { kind: JOURNAL_ACCEPT_RESULT.CONFLICT } as const
    return { outcome }
  }
  if ([...next.values()].some((record) => !isTerminalJournalState(record.state))) {
    return { outcome: { kind: JOURNAL_ACCEPT_RESULT.WORKER_BUSY } }
  }
  evictTerminalRecords(next, now, limits.maxRecords, true)
  if (next.size >= limits.maxRecords) {
    return { outcome: { kind: JOURNAL_ACCEPT_RESULT.CAPACITY } }
  }
  const record = CreateReplayRecordSchema.parse({
    expiresAt: new Date(now + limits.ttlMs).toISOString(),
    ownerSha256: context.ownerSha256,
    requestSha256: context.requestSha256,
    state: CREATE_JOURNAL_STATE.ACCEPTED,
    token: context.token,
    updatedAt: new Date(now).toISOString(),
  })
  next.set(record.token, record)
  return {
    next,
    outcome: { kind: JOURNAL_ACCEPT_RESULT.ACCEPTED, record },
  }
}
