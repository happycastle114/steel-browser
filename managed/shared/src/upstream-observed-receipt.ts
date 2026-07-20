import { isDeepStrictEqual } from "node:util"

import { z } from "zod"

import { RestCorpusEntrySchema, WebSocketCorpusEntrySchema } from "./upstream-corpus-model.js"
import { CorpusVerificationError, parseJson, parseNdjson, sha256 } from "./upstream-corpus-primitives.js"

export const OBSERVED_RECEIPT_PATH = "observed-receipt.json"

// Generation reads this source-owned anchor but never rewrites it.
const RECEIPT_SHA256_BY_UPSTREAM_SHA: ReadonlyMap<string, string> = new Map([
  ["c0f226b8e3b16d0bc2c76a222863d4db6f1aa8f2", "476d73479c68aa30e77124c217db62f62bab93025fcae7511798f79b6a6df484"],
])

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u)
const GitCommitShaSchema = z.string().regex(/^[0-9a-f]{40}$/u)
const ObservedRestEntrySchema = RestCorpusEntrySchema.pick({
  id: true,
  routeId: true,
})
  .extend({
    request: RestCorpusEntrySchema.shape.request.pick({
      method: true,
      path: true,
    }),
    response: RestCorpusEntrySchema.shape.response.pick({
      status: true,
      contentType: true,
      headers: true,
      bodySha256: true,
      urlFields: true,
    }),
  })
  .strict()
const ObservedWebSocketEntrySchema = WebSocketCorpusEntrySchema.pick({
  id: true,
  routeId: true,
  requestPath: true,
  opened: true,
  messageKind: true,
  closeCode: true,
}).strict()
export const ObservedReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    upstreamSha: GitCommitShaSchema,
    routeMatrixSha256: Sha256Schema,
    sessionIdVerdictSha256: Sha256Schema,
    rest: z.array(ObservedRestEntrySchema).nonempty(),
    webSocket: z.array(ObservedWebSocketEntrySchema).nonempty(),
  })
  .strict()

type ObservedRestEntry = Readonly<z.infer<typeof ObservedRestEntrySchema>>
type ObservedWebSocketEntry = Readonly<z.infer<typeof ObservedWebSocketEntrySchema>>

export type ObservedCorpusInput = {
  readonly upstreamSha: string
  readonly receiptText: string
  readonly restText: string
  readonly webSocketText: string
  readonly routeMatrixText: string
  readonly sessionIdVerdictText: string
}

const PRIVATE_ORIGIN_PATTERN =
  /\b(?:https?|wss?):\/\/(?:localhost|0\.0\.0\.0|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[::1\])(?=[:/])/iu

function requireEqual(actual: unknown, expected: unknown, detail: string): void {
  if (actual !== expected) {
    throw new CorpusVerificationError(detail)
  }
}

function requireDeepEqual(actual: unknown, expected: unknown, detail: string): void {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new CorpusVerificationError(detail)
  }
}

function indexById<T extends { readonly id: string }>(entries: readonly T[], artifact: string): ReadonlyMap<string, T> {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  requireEqual(byId.size, entries.length, `duplicate observed record ID: ${artifact}`)
  return byId
}

function requirePrivateOriginsRedacted(input: ObservedCorpusInput): void {
  const texts = [input.receiptText, input.restText, input.webSocketText, input.routeMatrixText, input.sessionIdVerdictText]
  for (const text of texts) {
    const privateOrigin = text.match(PRIVATE_ORIGIN_PATTERN)?.[0]
    if (privateOrigin !== undefined) {
      throw new CorpusVerificationError(`private origin leaked: ${privateOrigin}`)
    }
  }
}

function verifyRestObservations(expectedEntries: readonly ObservedRestEntry[], actualEntries: readonly ReturnType<typeof RestCorpusEntrySchema.parse>[]): void {
  const actualById = indexById(actualEntries, "rest.ndjson")
  requireEqual(actualById.size, expectedEntries.length, "observed REST record count drift")
  for (const expected of expectedEntries) {
    const actual = actualById.get(expected.id)
    if (actual === undefined) {
      throw new CorpusVerificationError(`observed REST record missing: ${expected.id}`)
    }
    requireEqual(actual.routeId, expected.routeId, `observed REST route drift: ${expected.id}`)
    requireEqual(actual.request.method, expected.request.method, `observed REST method drift: ${expected.id}`)
    requireEqual(actual.request.path, expected.request.path, `observed REST URL template drift: ${expected.id}`)
    requireEqual(actual.response.status, expected.response.status, `observed REST status drift: ${expected.id}`)
    requireEqual(actual.response.contentType, expected.response.contentType, `observed REST content type drift: ${expected.id}`)
    requireDeepEqual(actual.response.headers, expected.response.headers, `observed REST header drift: ${expected.id}`)
    requireEqual(actual.response.bodySha256, expected.response.bodySha256, `observed REST body digest drift: ${expected.id}`)
    requireDeepEqual(actual.response.urlFields, expected.response.urlFields, `observed REST URL field drift: ${expected.id}`)
  }
}

function verifyWebSocketObservations(
  expectedEntries: readonly ObservedWebSocketEntry[],
  actualEntries: readonly ReturnType<typeof WebSocketCorpusEntrySchema.parse>[],
): void {
  const actualById = indexById(actualEntries, "websocket.ndjson")
  requireEqual(actualById.size, expectedEntries.length, "observed WebSocket record count drift")
  for (const expected of expectedEntries) {
    const actual = actualById.get(expected.id)
    if (actual === undefined) {
      throw new CorpusVerificationError(`observed WebSocket record missing: ${expected.id}`)
    }
    requireEqual(actual.routeId, expected.routeId, `observed WebSocket route drift: ${expected.id}`)
    requireEqual(actual.requestPath, expected.requestPath, `observed WebSocket URL template drift: ${expected.id}`)
    requireEqual(actual.opened, expected.opened, `observed WebSocket open drift: ${expected.id}`)
    requireEqual(actual.messageKind, expected.messageKind, `observed WebSocket message drift: ${expected.id}`)
    requireEqual(actual.closeCode, expected.closeCode, `observed WebSocket close drift: ${expected.id}`)
  }
}

export function verifyObservedReceipt(input: ObservedCorpusInput): void {
  requirePrivateOriginsRedacted(input)
  const receipt = ObservedReceiptSchema.parse(parseJson(input.receiptText, OBSERVED_RECEIPT_PATH))
  requireEqual(receipt.upstreamSha, input.upstreamSha, "observed receipt upstream SHA drift")
  const sourcePinnedSha256 = RECEIPT_SHA256_BY_UPSTREAM_SHA.get(receipt.upstreamSha)
  if (sourcePinnedSha256 === undefined) {
    throw new CorpusVerificationError(`no source-pinned observed receipt: ${receipt.upstreamSha}`)
  }
  requireEqual(sha256(input.receiptText), sourcePinnedSha256, "observed receipt source anchor drift")

  const restEntries = parseNdjson(input.restText, "rest.ndjson").map((entry) => RestCorpusEntrySchema.parse(entry))
  const webSocketEntries = parseNdjson(input.webSocketText, "websocket.ndjson").map((entry) => WebSocketCorpusEntrySchema.parse(entry))
  verifyRestObservations(receipt.rest, restEntries)
  verifyWebSocketObservations(receipt.webSocket, webSocketEntries)
  requireEqual(sha256(input.routeMatrixText), receipt.routeMatrixSha256, "observed route matrix drift")
  requireEqual(sha256(input.sessionIdVerdictText), receipt.sessionIdVerdictSha256, "observed session verdict drift")
}
