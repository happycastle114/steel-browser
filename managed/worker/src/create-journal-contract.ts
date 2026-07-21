import { timingSafeEqual } from "node:crypto"
import type { IncomingMessage } from "node:http"
import {
  CONTROL_PLANE_DEFAULTS,
  CONTROL_PLANE_FIXED,
  CREATE_JOURNAL_STATE,
  CREATE_JOURNAL_VERSION,
  CreateTokenSchema,
  JOURNAL_ACCEPT_RESULT,
  MANAGED_CREATE_HEADER,
  MANAGED_CREATE_HEADER_NAMES,
  ManagedCreateHeaderValuesSchema,
  PRIVATE_SUPERVISOR_RETRY_AFTER_SECONDS,
  PUBLIC_URL_KIND,
  type CreateReplay,
  type CreateReplayRecord,
} from "@happycastle/steel-managed-shared"

export {
  CREATE_JOURNAL_STATE,
  CREATE_JOURNAL_VERSION,
  JOURNAL_ACCEPT_RESULT,
  MANAGED_CREATE_HEADER,
  MANAGED_CREATE_HEADER_NAMES,
  PUBLIC_URL_KIND,
}
export type { CreateReplay, CreateReplayRecord }

const MANAGED_CREATE_HEADER_NAME_SET: ReadonlySet<string> = new Set(
  MANAGED_CREATE_HEADER_NAMES,
)

export const CREATE_JOURNAL_POLICY = {
  CREATE_BODY_BYTES: CONTROL_PLANE_DEFAULTS.httpBodyBytes,
  CREATE_TIMEOUT_MS: CONTROL_PLANE_DEFAULTS.createTimeoutMs,
  JOURNAL_FILE: "/run/steel/create-journal.json",
  MAX_RECORDS: CONTROL_PLANE_FIXED.workerJournalMax,
  PROBE_RETRY_AFTER_SECONDS: PRIVATE_SUPERVISOR_RETRY_AFTER_SECONDS,
  RECORD_BYTES: CONTROL_PLANE_FIXED.workerReplayBytes,
  TTL_MS: CONTROL_PLANE_DEFAULTS.idempotencyTtlMs,
} as const

export type JournalAcceptOutcome =
  | { readonly kind: "ACCEPTED"; readonly record: CreateReplayRecord }
  | { readonly kind: "CAPACITY" }
  | { readonly kind: "CONFLICT" }
  | { readonly kind: "DUPLICATE"; readonly record: CreateReplayRecord }
  | { readonly kind: "WORKER_BUSY" }

export type ManagedCreateContext = {
  readonly managerInstanceId: string
  readonly ownerSha256: string
  readonly poolId: string
  readonly requestSha256: string
  readonly token: string
  readonly ownerDigest: Buffer
  readonly requestDigest: Buffer
}

export function parseCreateToken(input: string): string {
  return CreateTokenSchema.parse(input)
}

function uniqueHeaderValue(incoming: IncomingMessage, name: string): string | undefined {
  const values: string[] = []
  for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
    if (incoming.rawHeaders[index]?.toLowerCase() === name) {
      const value = incoming.rawHeaders[index + 1]
      if (value !== undefined) values.push(value)
    }
  }
  return values.length === 1 ? values[0] : undefined
}

export function hasManagedCreateHeaders(incoming: IncomingMessage): boolean {
  return incoming.rawHeaders.some((value, index) =>
    index % 2 === 0 && (
      value.toLowerCase().startsWith("x-managed-") ||
      value.toLowerCase().startsWith("x-steel-managed-")
    ),
  )
}

export function parseManagedCreateContext(incoming: IncomingMessage): ManagedCreateContext {
  const internalNames = incoming.rawHeaders
    .filter((_value, index) => index % 2 === 0)
    .map((value) => value.toLowerCase())
    .filter((value) => value.startsWith("x-managed-") || value.startsWith("x-steel-managed-"))
  if (internalNames.some((name) => !MANAGED_CREATE_HEADER_NAME_SET.has(name))) {
    throw new TypeError("managed create contains an unknown internal header")
  }
  const parsed = ManagedCreateHeaderValuesSchema.parse({
    [MANAGED_CREATE_HEADER.MANAGER_INSTANCE_ID]: uniqueHeaderValue(incoming, MANAGED_CREATE_HEADER.MANAGER_INSTANCE_ID),
    [MANAGED_CREATE_HEADER.OWNER_SHA256]: uniqueHeaderValue(incoming, MANAGED_CREATE_HEADER.OWNER_SHA256),
    [MANAGED_CREATE_HEADER.POOL_ID]: uniqueHeaderValue(incoming, MANAGED_CREATE_HEADER.POOL_ID),
    [MANAGED_CREATE_HEADER.REQUEST_SHA256]: uniqueHeaderValue(incoming, MANAGED_CREATE_HEADER.REQUEST_SHA256),
    [MANAGED_CREATE_HEADER.TOKEN]: uniqueHeaderValue(incoming, MANAGED_CREATE_HEADER.TOKEN),
  })
  const managerInstanceId = parsed[MANAGED_CREATE_HEADER.MANAGER_INSTANCE_ID]
  const ownerSha256 = parsed[MANAGED_CREATE_HEADER.OWNER_SHA256]
  const poolId = parsed[MANAGED_CREATE_HEADER.POOL_ID]
  const requestSha256 = parsed[MANAGED_CREATE_HEADER.REQUEST_SHA256]
  const token = parsed[MANAGED_CREATE_HEADER.TOKEN]
  return {
    managerInstanceId,
    ownerDigest: Buffer.from(ownerSha256, "hex"),
    ownerSha256,
    poolId,
    requestDigest: Buffer.from(requestSha256, "hex"),
    requestSha256,
    token,
  }
}

export function digestsEqual(leftHex: string, right: Buffer): boolean {
  const left = Buffer.from(leftHex, "hex")
  return left.byteLength === right.byteLength && timingSafeEqual(left, right)
}
