import {
  AI_ACTION_REQUEST_SCHEMA,
  JsonValueSchema,
  type AiActionRequest,
  type JsonValue,
  type PrincipalId,
  type ResultId,
  type SelectedPublicOrigin,
} from "@happycastle/steel-managed-shared"

export const RETAINED_RESULT_CONTENT = {
  JSON: "JSON",
  BINARY: "BINARY",
} as const

type RetainedResultBase = Readonly<{
  readonly resultId: ResultId
  readonly action: AiActionRequest
  readonly ownerId: PrincipalId
  readonly creatorId: PrincipalId
  readonly selectedOrigin: SelectedPublicOrigin
  readonly completedAtMs: number
  readonly expiresAtMs: number
  readonly output: JsonValue
}>

export type RetainedJsonResult = RetainedResultBase & Readonly<{
  readonly content: typeof RETAINED_RESULT_CONTENT.JSON
}>

export type RetainedBinaryResult = RetainedResultBase & Readonly<{
  readonly content: typeof RETAINED_RESULT_CONTENT.BINARY
  readonly bytes: Uint8Array
  readonly contentType: string
}>

export type RetainedResultRecord = RetainedJsonResult | RetainedBinaryResult

export interface RetainedResultStore {
  stage(input: RetainedResultRecord): boolean
  publish(resultId: ResultId): boolean
  get(resultId: ResultId): RetainedResultRecord | undefined
  delete(resultId: ResultId): boolean
  prune(nowMs: number): readonly ResultId[]
  clear(): readonly ResultId[]
  records(): readonly RetainedResultRecord[]
  size(): number
}

type StoredResult = Readonly<{
  readonly published: boolean
  readonly record: RetainedResultRecord
}>

export class InMemoryRetainedResultStore implements RetainedResultStore {
  readonly #records = new Map<ResultId, StoredResult>()

  public stage(input: RetainedResultRecord): boolean {
    if (this.#records.has(input.resultId)) return false
    this.#records.set(input.resultId, Object.freeze({ published: false, record: cloneRecord(input) }))
    return true
  }

  public publish(resultId: ResultId): boolean {
    const stored = this.#records.get(resultId)
    if (stored === undefined || stored.published) return false
    this.#records.set(resultId, Object.freeze({ published: true, record: stored.record }))
    return true
  }

  public get(resultId: ResultId): RetainedResultRecord | undefined {
    const stored = this.#records.get(resultId)
    return stored?.published === true ? cloneRecord(stored.record) : undefined
  }

  public delete(resultId: ResultId): boolean {
    return this.#records.delete(resultId)
  }

  public prune(nowMs: number): readonly ResultId[] {
    const removed: ResultId[] = []
    for (const [resultId, stored] of this.#records) {
      if (stored.record.expiresAtMs <= nowMs && this.#records.delete(resultId)) removed.push(resultId)
    }
    return Object.freeze(removed)
  }

  public clear(): readonly ResultId[] {
    const removed = Object.freeze([...this.#records.keys()])
    this.#records.clear()
    return removed
  }

  public records(): readonly RetainedResultRecord[] {
    return Object.freeze([...this.#records.values()]
      .filter((stored) => stored.published)
      .map((stored) => cloneRecord(stored.record)))
  }

  public size(): number {
    return this.#records.size
  }
}

function cloneRecord(input: RetainedResultRecord): RetainedResultRecord {
  const base = {
    resultId: input.resultId,
    action: AI_ACTION_REQUEST_SCHEMA.parse(input.action),
    ownerId: input.ownerId,
    creatorId: input.creatorId,
    selectedOrigin: input.selectedOrigin,
    completedAtMs: input.completedAtMs,
    expiresAtMs: input.expiresAtMs,
    output: freezeJson(JsonValueSchema.parse(input.output)),
  }
  switch (input.content) {
    case RETAINED_RESULT_CONTENT.JSON:
      return Object.freeze({ ...base, content: RETAINED_RESULT_CONTENT.JSON })
    case RETAINED_RESULT_CONTENT.BINARY:
      return Object.freeze({
        ...base,
        content: RETAINED_RESULT_CONTENT.BINARY,
        bytes: Uint8Array.from(input.bytes),
        contentType: input.contentType,
      })
  }
}

function freezeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJson))
  if (value === null || typeof value !== "object") return value
  const frozen: Record<string, JsonValue> = {}
  for (const [key, nested] of Object.entries(value)) frozen[key] = freezeJson(nested)
  return Object.freeze(frozen)
}
