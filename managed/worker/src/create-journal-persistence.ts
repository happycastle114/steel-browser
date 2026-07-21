import { mkdir, open, rename } from "node:fs/promises"
import { dirname } from "node:path"
import type { CreateReplayRecord } from "./create-journal-contract.js"

export type CreateJournalPersistence = {
  readonly write: (records: readonly CreateReplayRecord[]) => Promise<void>
}

export class AtomicCreateJournalFile implements CreateJournalPersistence {
  readonly #filePath: string

  constructor(filePath: string) {
    this.#filePath = filePath
  }

  async write(records: readonly CreateReplayRecord[]): Promise<void> {
    const directory = dirname(this.#filePath)
    const temporary = `${this.#filePath}.tmp`
    await mkdir(directory, { mode: 0o700, recursive: true })
    const file = await open(temporary, "w", 0o600)
    try {
      await file.writeFile(`${JSON.stringify(records)}\n`)
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporary, this.#filePath)
    const parent = await open(directory, "r")
    try {
      await parent.sync()
    } finally {
      await parent.close()
    }
  }
}
