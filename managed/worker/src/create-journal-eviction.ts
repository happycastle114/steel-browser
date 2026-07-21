import {
  type CreateReplayRecord,
} from "./create-journal-contract.js"
import { isTerminalJournalState } from "./create-journal-records.js"

export function evictTerminalRecords(
  records: Map<string, CreateReplayRecord>,
  now: number,
  maxRecords: number,
  forCapacity: boolean,
): void {
  const terminal = [...records.values()]
    .filter((record) => isTerminalJournalState(record.state))
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
  for (const record of terminal) {
    if (
      Date.parse(record.expiresAt) <= now ||
      (forCapacity && records.size >= maxRecords)
    ) {
      records.delete(record.token)
    }
  }
}
