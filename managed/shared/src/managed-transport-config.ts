import { z } from "zod"

import type { ControlPlaneConfig } from "./control-plane-config.js"
import { ByteCountSchema } from "./control-plane-primitives.js"

const PositiveByteCountSchema = ByteCountSchema.refine((value) => value > 0)

export const ManagedTransportConfigSchema = z.object({
  httpBodyBytes: PositiveByteCountSchema,
  textBytes: PositiveByteCountSchema,
  binaryBytes: PositiveByteCountSchema,
  resultBytes: PositiveByteCountSchema,
}).strict()

export type ManagedTransportConfig = Readonly<z.output<typeof ManagedTransportConfigSchema>>

export function deriveManagedTransportConfig(config: ControlPlaneConfig): ManagedTransportConfig {
  return ManagedTransportConfigSchema.parse({
    httpBodyBytes: config.httpBodyBytes,
    textBytes: config.aiTextBytes,
    binaryBytes: config.aiBinaryBytes,
    resultBytes: config.memory.resultBudgetBytes,
  })
}
