import { canonicalize } from "json-canonicalize"

import { JsonValueSchema } from "./json-value.js"

export { JsonValueSchema } from "./json-value.js"
export type { JsonValue } from "./json-value.js"

export function canonicalJson(value: unknown): string {
  return canonicalize(JsonValueSchema.parse(value))
}
