import { describe, expect, it } from "vitest"

import { loadCorpusBundle } from "../src/upstream-corpus-files.js"
import {
  CorpusManifestSchema,
  PROTOCOL_KIND,
  RestCorpusEntrySchema,
  RouteMatrixSchema,
  WEBSOCKET_MESSAGE_KIND,
  WEBSOCKET_UPGRADE_CLASS,
  WebSocketCorpusEntrySchema,
} from "../src/upstream-corpus-model.js"
import { CorpusVerificationError, sha256, verifyCorpusBundle, type CorpusBundle } from "../src/upstream-corpus-verifier.js"
import { LOCK_STAGE, parseUpstreamLock } from "../src/upstream-lock.js"
import { ObservedReceiptSchema } from "../src/upstream-observed-receipt.js"

const REPOSITORY_ROOT = new URL("../../../", import.meta.url).pathname
const ROUTE_ID = {
  HEALTH: "rest.health",
  SESSION_CREATE: "rest.sessions.create",
  WS_CAST: "ws.cast",
  WS_LOGS: "ws.logs",
} as const
const FIELD = {
  BODY_DIGEST: "REST body digest",
  CONTENT_TYPE: "REST content type",
  HEADER_VALUE: "REST header value",
  PRIVATE_ORIGIN: "private origin",
  STATUS: "REST status",
  URL_VALUE: "REST URL value",
  WS_CLOSE: "WebSocket close semantics",
  WS_MESSAGE: "WebSocket message semantics",
} as const
const CONTENT_TYPE_HEADER = "content-type"
const WEBSOCKET_URL_FIELD = "/websocketUrl"

function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function toNdjson(values: readonly unknown[]): string {
  return `${values.map((value) => JSON.stringify(value)).join("\n")}\n`
}

function relockBundle(bundle: CorpusBundle): CorpusBundle {
  const manifest = CorpusManifestSchema.parse(JSON.parse(bundle.manifestText))
  const artifactTexts = new Map([
    ["rest.ndjson", bundle.restText],
    ["websocket.ndjson", bundle.webSocketText],
    ["route-matrix.json", bundle.routeMatrixText],
    ["session-id-verdict.json", bundle.sessionIdVerdictText],
  ])
  const artifacts = manifest.artifacts.map((artifact) => {
    const text = artifactTexts.get(artifact.path)
    if (text === undefined) {
      throw new CorpusVerificationError(`unknown fixture artifact: ${artifact.path}`)
    }
    return { ...artifact, sha256: sha256(text) }
  })
  const manifestText = toJson({ ...manifest, artifacts })
  const lock = parseUpstreamLock(JSON.parse(bundle.lockText))
  if (lock.lockStage !== LOCK_STAGE.CORPUS_LOCKED) {
    throw new CorpusVerificationError("fixture lock is not corpus-locked")
  }
  return {
    ...bundle,
    manifestText,
    lockText: toJson({
      ...lock,
      protocolCorpusSha256: sha256(manifestText),
      sessionIdVerdictSha256: sha256(bundle.sessionIdVerdictText),
    }),
  }
}

function mutateRest(
  bundle: CorpusBundle,
  routeId: string,
  mutateResponse: (response: ReturnType<typeof RestCorpusEntrySchema.parse>["response"]) => ReturnType<typeof RestCorpusEntrySchema.parse>["response"],
): CorpusBundle {
  const records = bundle.restText
    .trimEnd()
    .split("\n")
    .map((line) => RestCorpusEntrySchema.parse(JSON.parse(line)))
  return {
    ...bundle,
    restText: toNdjson(records.map((record) => (record.routeId === routeId ? { ...record, response: mutateResponse(record.response) } : record))),
  }
}

function mutateExpectedRest(bundle: CorpusBundle, routeId: string, expected: Readonly<Record<string, readonly unknown[]>>): CorpusBundle {
  const matrix = RouteMatrixSchema.parse(JSON.parse(bundle.routeMatrixText))
  const routes = matrix.routes.map((route) =>
    route.protocol === PROTOCOL_KIND.REST && route.id === routeId ? { ...route, expected: { ...route.expected, ...expected } } : route,
  )
  return { ...bundle, routeMatrixText: toJson({ ...matrix, routes }) }
}

function mutateWebSocket(bundle: CorpusBundle, routeId: string, fields: Readonly<Record<string, string | number>>): CorpusBundle {
  const records = bundle.webSocketText
    .trimEnd()
    .split("\n")
    .map((line) => WebSocketCorpusEntrySchema.parse(JSON.parse(line)))
  return {
    ...bundle,
    webSocketText: toNdjson(records.map((record) => (record.routeId === routeId ? { ...record, ...fields } : record))),
  }
}

function mutateExpectedWebSocket(bundle: CorpusBundle, routeId: string, fields: Readonly<Record<string, string | readonly number[]>>): CorpusBundle {
  const matrix = RouteMatrixSchema.parse(JSON.parse(bundle.routeMatrixText))
  const routes = matrix.routes.map((route) => (route.protocol === PROTOCOL_KIND.WEBSOCKET && route.id === routeId ? { ...route, ...fields } : route))
  return { ...bundle, routeMatrixText: toJson({ ...matrix, routes }) }
}

type MutationCase = {
  readonly field: (typeof FIELD)[keyof typeof FIELD]
  readonly error: string
  readonly mutate: (bundle: CorpusBundle) => CorpusBundle
}

const MUTATION_CASES = [
  {
    field: FIELD.STATUS,
    error: "observed REST status drift",
    mutate: (bundle) =>
      relockBundle(
        mutateExpectedRest(
          mutateRest(bundle, ROUTE_ID.HEALTH, (response) => ({
            ...response,
            status: 201,
          })),
          ROUTE_ID.HEALTH,
          { statuses: [201, 503] },
        ),
      ),
  },
  {
    field: FIELD.CONTENT_TYPE,
    error: "observed REST content type drift",
    mutate: (bundle) =>
      relockBundle(
        mutateExpectedRest(
          mutateRest(bundle, ROUTE_ID.HEALTH, (response) => ({
            ...response,
            contentType: "application/problem+json",
          })),
          ROUTE_ID.HEALTH,
          { contentTypes: ["application/problem+json"] },
        ),
      ),
  },
  {
    field: FIELD.HEADER_VALUE,
    error: "observed REST header drift",
    mutate: (bundle) =>
      relockBundle(
        mutateRest(bundle, ROUTE_ID.HEALTH, (response) => ({
          ...response,
          headers: {
            ...response.headers,
            [CONTENT_TYPE_HEADER]: "application/problem+json",
          },
        })),
      ),
  },
  {
    field: FIELD.URL_VALUE,
    error: "observed REST URL field drift",
    mutate: (bundle) =>
      relockBundle(
        mutateRest(bundle, ROUTE_ID.SESSION_CREATE, (response) => ({
          ...response,
          urlFields: {
            ...response.urlFields,
            [WEBSOCKET_URL_FIELD]: "https://example.invalid/v1/ws?sessionId=<SESSION_ID>",
          },
        })),
      ),
  },
  {
    field: FIELD.BODY_DIGEST,
    error: "observed REST body digest drift",
    mutate: (bundle) =>
      relockBundle(
        mutateRest(bundle, ROUTE_ID.HEALTH, (response) => ({
          ...response,
          bodySha256: "b".repeat(64),
        })),
      ),
  },
  {
    field: FIELD.WS_MESSAGE,
    error: "observed WebSocket message drift",
    mutate: (bundle) =>
      relockBundle(
        mutateExpectedWebSocket(
          mutateWebSocket(bundle, ROUTE_ID.WS_LOGS, {
            messageKind: WEBSOCKET_MESSAGE_KIND.BROWSER_GET_VERSION,
          }),
          ROUTE_ID.WS_LOGS,
          { upgradeClass: WEBSOCKET_UPGRADE_CLASS.ROOT_CDP },
        ),
      ),
  },
  {
    field: FIELD.WS_CLOSE,
    error: "observed WebSocket close drift",
    mutate: (bundle) =>
      relockBundle(mutateExpectedWebSocket(mutateWebSocket(bundle, ROUTE_ID.WS_CAST, { closeCode: 1011 }), ROUTE_ID.WS_CAST, { expectedCloseCodes: [1011] })),
  },
  {
    field: FIELD.PRIVATE_ORIGIN,
    error: "private origin leaked",
    mutate: (bundle) =>
      relockBundle(
        mutateRest(bundle, ROUTE_ID.SESSION_CREATE, (response) => ({
          ...response,
          urlFields: {
            ...response.urlFields,
            [WEBSOCKET_URL_FIELD]: "http://127.0.0.1:34110/v1/ws?sessionId=<SESSION_ID>",
          },
        })),
      ),
  },
] satisfies readonly MutationCase[]

describe("corpus metadata relock resistance", () => {
  it.each(MUTATION_CASES)("rejects a relocked $field mutation", async ({ error, mutate }) => {
    // Given
    const bundle = await loadCorpusBundle(REPOSITORY_ROOT)
    const mutated = mutate(bundle)

    // When
    const verify = () => verifyCorpusBundle(mutated)

    // Then
    expect(verify).toThrowError(CorpusVerificationError)
    expect(verify).toThrow(error)
  })

  it("rejects an edited observed receipt that matches a relocked mutation", async () => {
    // Given
    const bundle = await loadCorpusBundle(REPOSITORY_ROOT)
    const statusMutated = mutateExpectedRest(
      mutateRest(bundle, ROUTE_ID.HEALTH, (response) => ({
        ...response,
        status: 201,
      })),
      ROUTE_ID.HEALTH,
      { statuses: [201, 503] },
    )
    const receipt = ObservedReceiptSchema.parse(JSON.parse(bundle.observedReceiptText))
    const rest = receipt.rest.map((record) => (record.routeId === ROUTE_ID.HEALTH ? { ...record, response: { ...record.response, status: 201 } } : record))
    const mutated = relockBundle({
      ...statusMutated,
      observedReceiptText: toJson({ ...receipt, rest }),
    })

    // When
    const verify = () => verifyCorpusBundle(mutated)

    // Then
    expect(verify).toThrowError(CorpusVerificationError)
    expect(verify).toThrow("observed receipt source anchor drift")
  })
})
