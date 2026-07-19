import { z } from "zod"

export const PROTOCOL_KIND = {
  REST: "REST",
  WEBSOCKET: "WEBSOCKET",
} as const

export const HTTP_METHOD = {
  ALL: "ALL",
  DELETE: "DELETE",
  GET: "GET",
  HEAD: "HEAD",
  OPTIONS: "OPTIONS",
  POST: "POST",
} as const

export const AFFINITY_RULE = {
  CREATE: "CREATE",
  NONE: "NONE",
  PATH_SESSION_ID: "PATH_SESSION_ID",
  UNSCOPED_ACTIVE_SESSION: "UNSCOPED_ACTIVE_SESSION",
} as const

export const LIFECYCLE_CLASS = {
  ACTION: "ACTION",
  CONTEXT: "CONTEXT",
  CREATE: "CREATE",
  DEBUG: "DEBUG",
  DOCUMENTATION: "DOCUMENTATION",
  EVENT: "EVENT",
  FILE: "FILE",
  HEALTH: "HEALTH",
  LIVE_DETAILS: "LIVE_DETAILS",
  LOG: "LOG",
  READ: "READ",
  RELEASE: "RELEASE",
  SELENIUM: "SELENIUM",
  WEBSOCKET: "WEBSOCKET",
} as const

export const SESSION_ID_MODE = {
  CLIENT_SUPPLIED: "CLIENT_SUPPLIED",
  UPSTREAM_RETURNED: "UPSTREAM_RETURNED",
} as const

export const CREATE_JOURNAL_BINDING = {
  CLIENT_ID_DIRECT: "CLIENT_ID_DIRECT",
  CREATE_TOKEN_TO_UPSTREAM_RETURNED_ID: "CREATE_TOKEN_TO_UPSTREAM_RETURNED_ID",
} as const

export const WEBSOCKET_UPGRADE_CLASS = {
  CAST: "CAST",
  LOGS: "LOGS",
  PAGE_ID: "PAGE_ID",
  RECORDING: "RECORDING",
  ROOT_CDP: "ROOT_CDP",
} as const

export const WEBSOCKET_MESSAGE_KIND = {
  BROWSER_GET_VERSION: "BROWSER_GET_VERSION",
  OPEN_NO_MESSAGE: "OPEN_NO_MESSAGE",
  TAB_LIST: "TAB_LIST",
} as const

export const WEBSOCKET_MESSAGE_BY_UPGRADE = {
  [WEBSOCKET_UPGRADE_CLASS.CAST]: WEBSOCKET_MESSAGE_KIND.TAB_LIST,
  [WEBSOCKET_UPGRADE_CLASS.LOGS]: WEBSOCKET_MESSAGE_KIND.OPEN_NO_MESSAGE,
  [WEBSOCKET_UPGRADE_CLASS.PAGE_ID]: WEBSOCKET_MESSAGE_KIND.OPEN_NO_MESSAGE,
  [WEBSOCKET_UPGRADE_CLASS.RECORDING]: WEBSOCKET_MESSAGE_KIND.OPEN_NO_MESSAGE,
  [WEBSOCKET_UPGRADE_CLASS.ROOT_CDP]: WEBSOCKET_MESSAGE_KIND.BROWSER_GET_VERSION,
} as const

export const RUNTIME_CONDITION = {
  ALWAYS: "ALWAYS",
  LOG_STORAGE_ENABLED: "LOG_STORAGE_ENABLED",
} as const

export const BODY_KIND = {
  BINARY: "BINARY",
  EMPTY: "EMPTY",
  HTML: "HTML",
  JSON: "JSON",
  MULTIPART: "MULTIPART",
  SSE: "SSE",
  TEXT: "TEXT",
  YAML: "YAML",
} as const

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u)
const GitCommitShaSchema = z.string().regex(/^[0-9a-f]{40}$/u)
const IdentifierSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/u)
const HttpMethodSchema = z.enum([
  HTTP_METHOD.ALL,
  HTTP_METHOD.DELETE,
  HTTP_METHOD.GET,
  HTTP_METHOD.HEAD,
  HTTP_METHOD.OPTIONS,
  HTTP_METHOD.POST,
])
const AffinityRuleSchema = z.enum([
  AFFINITY_RULE.CREATE,
  AFFINITY_RULE.NONE,
  AFFINITY_RULE.PATH_SESSION_ID,
  AFFINITY_RULE.UNSCOPED_ACTIVE_SESSION,
])
const LifecycleClassSchema = z.enum([
  LIFECYCLE_CLASS.ACTION,
  LIFECYCLE_CLASS.CONTEXT,
  LIFECYCLE_CLASS.CREATE,
  LIFECYCLE_CLASS.DEBUG,
  LIFECYCLE_CLASS.DOCUMENTATION,
  LIFECYCLE_CLASS.EVENT,
  LIFECYCLE_CLASS.FILE,
  LIFECYCLE_CLASS.HEALTH,
  LIFECYCLE_CLASS.LIVE_DETAILS,
  LIFECYCLE_CLASS.LOG,
  LIFECYCLE_CLASS.READ,
  LIFECYCLE_CLASS.RELEASE,
  LIFECYCLE_CLASS.SELENIUM,
  LIFECYCLE_CLASS.WEBSOCKET,
])
const RuntimeConditionSchema = z.enum([
  RUNTIME_CONDITION.ALWAYS,
  RUNTIME_CONDITION.LOG_STORAGE_ENABLED,
])
const BodyKindSchema = z.enum([
  BODY_KIND.BINARY,
  BODY_KIND.EMPTY,
  BODY_KIND.HTML,
  BODY_KIND.JSON,
  BODY_KIND.MULTIPART,
  BODY_KIND.SSE,
  BODY_KIND.TEXT,
  BODY_KIND.YAML,
])

const ExpectedHttpSchema = z
  .object({
    statuses: z.array(z.number().int().min(100).max(599)).nonempty(),
    contentTypes: z.array(z.string()).nonempty(),
    headers: z.array(z.string()),
    urlFields: z.array(z.string()),
  })
  .strict()

const RestRouteSchema = z
  .object({
    protocol: z.literal(PROTOCOL_KIND.REST),
    id: IdentifierSchema,
    method: HttpMethodSchema,
    path: z.string().startsWith("/"),
    source: z.string().min(1),
    runtimeCondition: RuntimeConditionSchema,
    affinity: AffinityRuleSchema,
    lifecycle: LifecycleClassSchema,
    mutating: z.boolean(),
    implicitHead: z.boolean(),
    expected: ExpectedHttpSchema,
  })
  .strict()

const WebSocketRouteSchema = z
  .object({
    protocol: z.literal(PROTOCOL_KIND.WEBSOCKET),
    id: IdentifierSchema,
    path: z.string().startsWith("/"),
    source: z.string().min(1),
    runtimeCondition: RuntimeConditionSchema,
    affinity: AffinityRuleSchema,
    lifecycle: z.literal(LIFECYCLE_CLASS.WEBSOCKET),
    mutating: z.boolean(),
    upgradeClass: z.enum([WEBSOCKET_UPGRADE_CLASS.CAST, WEBSOCKET_UPGRADE_CLASS.LOGS, WEBSOCKET_UPGRADE_CLASS.PAGE_ID, WEBSOCKET_UPGRADE_CLASS.RECORDING, WEBSOCKET_UPGRADE_CLASS.ROOT_CDP]),
    expectedCloseCodes: z.array(z.number().int().min(1000).max(4999)).nonempty(),
  })
  .strict()

export const RouteMatrixSchema = z
  .object({
    schemaVersion: z.literal(1),
    upstreamSha: GitCommitShaSchema,
    runtimeProfile: z
      .object({
        nodeEnv: z.literal("development"),
        logStorageEnabled: z.literal(true),
      })
      .strict(),
    routes: z.array(z.discriminatedUnion("protocol", [RestRouteSchema, WebSocketRouteSchema])),
  })
  .strict()

const CorpusResponseSchema = z
  .object({
    status: z.number().int().min(100).max(599),
    contentType: z.string(),
    headers: z.record(z.string()),
    bodyKind: BodyKindSchema,
    bodySha256: Sha256Schema,
    urlFields: z.record(z.string()),
  })
  .strict()

export const RestCorpusEntrySchema = z
  .object({
    schemaVersion: z.literal(1),
    id: IdentifierSchema,
    routeId: IdentifierSchema,
    scenario: z.string().min(1),
    request: z
      .object({ method: HttpMethodSchema, path: z.string().startsWith("/"), bodyKind: BodyKindSchema })
      .strict(),
    response: CorpusResponseSchema,
  })
  .strict()

export const WebSocketCorpusEntrySchema = z
  .object({
    schemaVersion: z.literal(1),
    id: IdentifierSchema,
    routeId: IdentifierSchema,
    scenario: z.string().min(1),
    requestPath: z.string().startsWith("/"),
    opened: z.literal(true),
    messageKind: z.enum([WEBSOCKET_MESSAGE_KIND.BROWSER_GET_VERSION, WEBSOCKET_MESSAGE_KIND.OPEN_NO_MESSAGE, WEBSOCKET_MESSAGE_KIND.TAB_LIST]),
    closeCode: z.number().int().min(1000).max(4999),
  })
  .strict()

export const SessionIdVerdictSchema = z
  .object({
    schemaVersion: z.literal(1),
    upstreamSha: GitCommitShaSchema,
    mode: z.enum([SESSION_ID_MODE.CLIENT_SUPPLIED, SESSION_ID_MODE.UPSTREAM_RETURNED]),
    callerSessionId: z.string().uuid(),
    createReturnedCallerId: z.boolean(),
    freshConnectionListRecoveredActiveId: z.boolean(),
    freshConnectionGetRecoveredActiveId: z.boolean(),
    releaseReturnedActiveId: z.boolean(),
    createJournalBinding: z.enum([
      CREATE_JOURNAL_BINDING.CLIENT_ID_DIRECT,
      CREATE_JOURNAL_BINDING.CREATE_TOKEN_TO_UPSTREAM_RETURNED_ID,
    ]),
  })
  .strict()

const ManifestArtifactSchema = z
  .object({ path: z.string().min(1), sha256: Sha256Schema, records: z.number().int().positive() })
  .strict()
const ManifestSourceSchema = z
  .object({ path: z.string().min(1), sha256: Sha256Schema })
  .strict()

export const CorpusManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    upstreamSha: GitCommitShaSchema,
    sessionIdMode: z.enum([SESSION_ID_MODE.CLIENT_SUPPLIED, SESSION_ID_MODE.UPSTREAM_RETURNED]),
    sourceInventorySha256: Sha256Schema,
    sources: z.array(ManifestSourceSchema).nonempty(),
    artifacts: z.array(ManifestArtifactSchema).length(4),
    restRouteCount: z.number().int().positive(),
    webSocketRouteCount: z.number().int().positive(),
  })
  .strict()

export type RouteMatrix = Readonly<z.infer<typeof RouteMatrixSchema>>
export type RestCorpusEntry = Readonly<z.infer<typeof RestCorpusEntrySchema>>
export type WebSocketCorpusEntry = Readonly<z.infer<typeof WebSocketCorpusEntrySchema>>
export type SessionIdVerdict = Readonly<z.infer<typeof SessionIdVerdictSchema>>
export type CorpusManifest = Readonly<z.infer<typeof CorpusManifestSchema>>
