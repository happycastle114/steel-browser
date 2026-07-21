import { ActiveCreateReplayRecordSchema, type ActiveCreateReplayRecord } from "@happycastle/steel-managed-shared"
import {
  CREATE_JOURNAL_POLICY,
  CREATE_JOURNAL_STATE,
  type CreateReplay,
  type CreateReplayRecord,
  type ManagedCreateContext,
  type JournalAcceptOutcome,
} from "./create-journal-contract.js"
import { decideCreateAcceptance } from "./create-journal-acceptance.js"
import {
  CREATE_COMPLETION_RESULT,
  decideCreateCompletion,
  isTerminalJournalState,
  reconcileCreateReplayRecords,
  transitionCreateReplayRecord,
  uncertainCreateReplayRecord,
} from "./create-journal-records.js"
import { AtomicCreateJournalFile, type CreateJournalPersistence } from "./create-journal-persistence.js"

export type JournalClock = { readonly now: () => number }

export type CreateJournalLimits = {
  readonly maxRecords: number
  readonly recordBytes: number
  readonly ttlMs: number
}

const SYSTEM_CLOCK: JournalClock = { now: Date.now }

export class CreateJournalStore {
  readonly #clock: JournalClock
  readonly #limits: CreateJournalLimits
  readonly #persistence: CreateJournalPersistence
  readonly #records = new Map<string, CreateReplayRecord>()
  #tail: Promise<void> = Promise.resolve()

  constructor(
    filePath: string = CREATE_JOURNAL_POLICY.JOURNAL_FILE,
    clock: JournalClock = SYSTEM_CLOCK,
    limits: CreateJournalLimits = {
      maxRecords: CREATE_JOURNAL_POLICY.MAX_RECORDS,
      recordBytes: CREATE_JOURNAL_POLICY.RECORD_BYTES,
      ttlMs: CREATE_JOURNAL_POLICY.TTL_MS,
    },
    persistence: CreateJournalPersistence = new AtomicCreateJournalFile(filePath),
  ) {
    this.#clock = clock
    this.#limits = limits
    this.#persistence = persistence
  }

  async initialize(): Promise<void> {
    await this.#exclusive(async () => {
      await this.#persistence.write([])
      this.#records.clear()
    })
  }

  async accept(context: ManagedCreateContext): Promise<JournalAcceptOutcome> {
    return this.#exclusive(async () => {
      const decision = decideCreateAcceptance(this.#records, context, this.#clock.now(), this.#limits)
      if (decision.next !== undefined) {
        await this.#commit(decision.next)
      }
      return decision.outcome
    })
  }

  async markPending(token: string): Promise<void> {
    await this.#transition(
      token,
      [CREATE_JOURNAL_STATE.ACCEPTED],
      CREATE_JOURNAL_STATE.UPSTREAM_PENDING,
    )
  }

  async markUncertain(token: string): Promise<void> {
    await this.#exclusive(async () => {
      const current = this.#required(token)
      if (current.state === CREATE_JOURNAL_STATE.UNCERTAIN) return
      if (
        current.state !== CREATE_JOURNAL_STATE.ACCEPTED &&
        current.state !== CREATE_JOURNAL_STATE.UPSTREAM_PENDING
      ) {
        throw new TypeError("create journal uncertainty is out of order")
      }
      const next = new Map(this.#records)
      next.set(token, uncertainCreateReplayRecord(current, this.#clock.now()))
      await this.#commit(next)
    })
  }

  async complete(
    token: string,
    state: typeof CREATE_JOURNAL_STATE.LIVE | typeof CREATE_JOURNAL_STATE.FAILED_TERMINAL,
    replay: CreateReplay,
    upstreamSessionId?: string,
  ): Promise<boolean> {
    return this.#exclusive(async () => {
      const current = this.#required(token)
      if (
        current.state !== CREATE_JOURNAL_STATE.UPSTREAM_PENDING &&
        current.state !== CREATE_JOURNAL_STATE.UNCERTAIN
      ) {
        throw new TypeError("create journal completion is out of order")
      }
      const decision = decideCreateCompletion(
        current,
        state,
        replay,
        upstreamSessionId,
        this.#clock.now(),
        this.#limits.ttlMs,
        this.#limits.recordBytes,
      )
      if (decision.kind === CREATE_COMPLETION_RESULT.UNCHANGED) {
        return false
      }
      const next = new Map(this.#records)
      next.set(token, decision.record)
      await this.#commit(next)
      return decision.kind === CREATE_COMPLETION_RESULT.COMPLETED
    })
  }

  async reconcileIdle(): Promise<void> {
    await this.reconcileActiveSession(null)
  }

  async reconcileActiveSession(sessionId: string | null): Promise<void> {
    await this.#exclusive(async () => {
      const next = reconcileCreateReplayRecords(this.#records, sessionId, this.#clock.now, this.#limits.ttlMs)
      if (next !== undefined) await this.#commit(next)
    })
  }

  async lookup(token: string): Promise<CreateReplayRecord | undefined> {
    return this.#exclusive(async () => this.#records.get(token))
  }

  async active(): Promise<readonly ActiveCreateReplayRecord[]> {
    return this.#exclusive(async () =>
      [...this.#records.values()]
        .filter((record) => !isTerminalJournalState(record.state))
        .slice(0, 1)
        .map((record) => ActiveCreateReplayRecordSchema.parse(record)),
    )
  }

  async #transition(
    token: string,
    allowed: readonly CreateReplayRecord["state"][],
    state: CreateReplayRecord["state"],
  ): Promise<void> {
    await this.#exclusive(async () => {
      const current = this.#required(token)
      if (!allowed.includes(current.state)) {
        throw new TypeError("create journal transition is out of order")
      }
      const next = new Map(this.#records)
      next.set(
        token,
        transitionCreateReplayRecord(
          current,
          state,
          this.#clock.now(),
          undefined,
          undefined,
          this.#limits.ttlMs,
        ),
      )
      await this.#commit(next)
    })
  }

  #required(token: string): CreateReplayRecord {
    const record = this.#records.get(token)
    if (record === undefined) throw new TypeError("create journal token is missing")
    return record
  }

  async #commit(next: ReadonlyMap<string, CreateReplayRecord>): Promise<void> {
    await this.#persistence.write([...next.values()])
    this.#records.clear()
    for (const [token, record] of next) {
      this.#records.set(token, record)
    }
  }

  async #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation, operation)
    this.#tail = result.then(() => undefined, () => undefined)
    return result
  }
}
