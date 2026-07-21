import { CreateIdempotencyKeySchema, type CreateIdempotencyKey } from "./schema-primitives.js"

const PENDING_CREATE_KEY_STORAGE = "steel.managed.pending-create-key.v1"

export function loadPendingCreateKey(): CreateIdempotencyKey | undefined {
  try {
    const stored = globalThis.sessionStorage.getItem(PENDING_CREATE_KEY_STORAGE)
    if (stored === null) return undefined
    const parsed = CreateIdempotencyKeySchema.safeParse(stored)
    if (parsed.success) return parsed.data
    globalThis.sessionStorage.removeItem(PENDING_CREATE_KEY_STORAGE)
    return undefined
  } catch {
    return undefined
  }
}

export function savePendingCreateKey(key: CreateIdempotencyKey): void {
  try {
    globalThis.sessionStorage.setItem(PENDING_CREATE_KEY_STORAGE, key)
  } catch {
    return
  }
}

export function clearPendingCreateKey(): void {
  try {
    globalThis.sessionStorage.removeItem(PENDING_CREATE_KEY_STORAGE)
  } catch {
    return
  }
}
