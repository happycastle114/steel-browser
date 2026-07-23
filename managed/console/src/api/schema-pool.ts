import {
  MemoryLedgerSchema,
  PoolSchema,
} from "@happycastle/steel-managed-shared/browser"
import { z } from "zod"

export { MemoryLedgerSchema, PoolSchema }

export type Pool = z.output<typeof PoolSchema>
export type MemoryLedger = z.output<typeof MemoryLedgerSchema>
