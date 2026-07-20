import type { z } from "zod"

export type DeepReadonly<Value> = Value extends object
  ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
  : Value

export function withDeepReadonlyOutput<Schema extends z.ZodTypeAny>(schema: Schema) {
  return schema.transform((value): DeepReadonly<z.output<Schema>> => value)
}
