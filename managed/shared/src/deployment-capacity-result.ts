import { z } from "zod"

import { CAPACITY_GATE_OUTCOME } from "./deployment-vocabulary.js"

export const CAPACITY_GATE_RESULT = {
  VERIFIED: { outcome: CAPACITY_GATE_OUTCOME.VERIFIED },
  BLOCKED_MEMORY: { outcome: CAPACITY_GATE_OUTCOME.BLOCKED_MEMORY },
  BLOCKED_CPU: { outcome: CAPACITY_GATE_OUTCOME.BLOCKED_CPU },
  BLOCKED_DISK: { outcome: CAPACITY_GATE_OUTCOME.BLOCKED_DISK },
  BLOCKED_INODES: { outcome: CAPACITY_GATE_OUTCOME.BLOCKED_INODES },
  BLOCKED_SHM_TMPFS: { outcome: CAPACITY_GATE_OUTCOME.BLOCKED_SHM_TMPFS },
  BLOCKED_PRESSURE: { outcome: CAPACITY_GATE_OUTCOME.BLOCKED_PRESSURE },
  BLOCKED_MEASUREMENT: { outcome: CAPACITY_GATE_OUTCOME.BLOCKED_MEASUREMENT },
} as const

export const CapacityGateResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal(CAPACITY_GATE_OUTCOME.VERIFIED) }).strict(),
  z.object({ outcome: z.literal(CAPACITY_GATE_OUTCOME.BLOCKED_MEMORY) }).strict(),
  z.object({ outcome: z.literal(CAPACITY_GATE_OUTCOME.BLOCKED_CPU) }).strict(),
  z.object({ outcome: z.literal(CAPACITY_GATE_OUTCOME.BLOCKED_DISK) }).strict(),
  z.object({ outcome: z.literal(CAPACITY_GATE_OUTCOME.BLOCKED_INODES) }).strict(),
  z.object({ outcome: z.literal(CAPACITY_GATE_OUTCOME.BLOCKED_SHM_TMPFS) }).strict(),
  z.object({ outcome: z.literal(CAPACITY_GATE_OUTCOME.BLOCKED_PRESSURE) }).strict(),
  z.object({ outcome: z.literal(CAPACITY_GATE_OUTCOME.BLOCKED_MEASUREMENT) }).strict(),
])

export type CapacityGateResult = Readonly<z.infer<typeof CapacityGateResultSchema>>
