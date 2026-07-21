import type { z } from "zod"

type Primitive = bigint | boolean | null | number | string | symbol | undefined

export type DeepReadonly<Value> = Value extends Primitive
  ? Value
  : Value extends object
    ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
    : Value

function freezeRecursively(value: unknown): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return
  for (const nested of Object.values(value)) freezeRecursively(nested)
  Object.freeze(value)
}

export function withDeepFrozenOutput<Output, Definition extends z.ZodTypeDef, Input>(
  schema: z.ZodType<Output, Definition, Input>,
): z.ZodEffects<z.ZodType<Output, Definition, Input>, DeepReadonly<Output>, Input>
export function withDeepFrozenOutput<Output, Definition extends z.ZodTypeDef, Input>(
  schema: z.ZodType<Output, Definition, Input>,
) {
  return schema.transform((value) => {
    freezeRecursively(value)
    return value
  })
}
