import { UnexpectedVariantError } from "./errors.js"

export function assertNever(_value: never): never {
  throw new UnexpectedVariantError()
}
