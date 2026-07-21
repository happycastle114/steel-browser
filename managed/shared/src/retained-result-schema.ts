import { z } from "zod"

import {
  IsoTimeSchema,
  MillisecondCountSchema,
  type ResultId,
} from "./control-plane-primitives.js"
import type { ManagedTransportConfig } from "./managed-transport-config.js"
import type { SelectedPublicOrigin } from "./public-urls.js"
import { createToolResultSchemas } from "./tool-result-schemas.js"

export type RetainedBinaryResultContract = Readonly<{
  readonly selectedOrigin: SelectedPublicOrigin
  readonly transport: ManagedTransportConfig
  readonly resultId: ResultId
  readonly completedAtMs: number
  readonly resultTtlMs: number
}>

export function createRetainedBinaryResultSchema(input: RetainedBinaryResultContract) {
  const completedAtMs = MillisecondCountSchema.parse(input.completedAtMs)
  const resultTtlMs = MillisecondCountSchema.parse(input.resultTtlMs)
  const expiresAtMs = MillisecondCountSchema.parse(completedAtMs + resultTtlMs)
  const expiresAt = IsoTimeSchema.parse(new Date(expiresAtMs).toISOString())
  return createToolResultSchemas(input.selectedOrigin, input.transport).BinaryResultSchema.superRefine(
    (result, context) => {
      if (result.resultId !== input.resultId) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "retained result ID mismatch" })
      }
      if (result.expiresAt !== expiresAt) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "retained result expiry mismatch" })
      }
    },
  )
}
