import { z } from "zod"

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | Readonly<{ readonly [key: string]: JsonValue }>

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ]),
)
