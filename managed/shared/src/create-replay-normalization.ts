import {
  CreateReplaySchema,
  PUBLIC_URL_KIND,
  PublicUrlPlaceholderSchema,
  type CreateBodyTemplate,
  type CreateReplay,
} from "./create-replay-contract.js"
import { SessionIdSchema, type SessionId } from "./control-plane-primitives.js"
import { CREATE_REPLAY_TEMPLATE_KIND } from "./control-plane-vocabulary.js"

const URL_FIELD_POLICY = [
  ["websocketUrl", PUBLIC_URL_KIND.WEBSOCKET, ["ws:", "wss:"]],
  ["debugUrl", PUBLIC_URL_KIND.DEBUG, ["http:", "https:"]],
  ["debuggerUrl", PUBLIC_URL_KIND.DEVTOOLS, ["http:", "https:"]],
  ["sessionViewerUrl", PUBLIC_URL_KIND.VIEWER, ["http:", "https:"]],
] as const

type ReplaySource = Readonly<{
  status: number
  contentType: string
  body: unknown
  location?: string
  retryAfterSeconds?: number
}>

export class UnrepresentableCreateReplayError extends Error {
  override readonly name = "UnrepresentableCreateReplayError"
}

function isObjectValue(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input)
}

function objectValue(input: unknown): Record<string, unknown> {
  if (!isObjectValue(input)) throw new UnrepresentableCreateReplayError()
  return input
}

function absoluteUrl(value: string, protocols: readonly string[]): URL {
  try {
    const parsed = new URL(value)
    if (parsed.username !== "" || parsed.password !== "" || !protocols.includes(parsed.protocol)) {
      throw new UnrepresentableCreateReplayError()
    }
    return parsed
  } catch (error) {
    if (error instanceof UnrepresentableCreateReplayError) throw error
    throw new UnrepresentableCreateReplayError()
  }
}

function containsAbsoluteUrl(value: CreateBodyTemplate): boolean {
  if (typeof value === "string") {
    try {
      return new URL(value).protocol.length > 0
    } catch {
      return false
    }
  }
  if (Array.isArray(value)) return value.some(containsAbsoluteUrl)
  if (value !== null && typeof value === "object") {
    if (PublicUrlPlaceholderSchema.safeParse(value).success) return false
    return Object.values(value).some(containsAbsoluteUrl)
  }
  return false
}

export function normalizeCreateReplay(input: ReplaySource): Readonly<{
  replay: CreateReplay
  sessionId?: SessionId
}> {
  const body = objectValue(input.body)
  const sessionId = body["id"] === undefined ? undefined : SessionIdSchema.parse(body["id"])
  const template: Record<string, unknown> = { ...body }
  const placeholders = new Map<string, CreateBodyTemplate>()
  for (const [field, urlKind, protocols] of URL_FIELD_POLICY) {
    const value = body[field]
    if (value === undefined) continue
    if (sessionId === undefined || typeof value !== "string") throw new UnrepresentableCreateReplayError()
    absoluteUrl(value, protocols)
    const placeholder = {
      kind: CREATE_REPLAY_TEMPLATE_KIND.PUBLIC_URL,
      sessionId,
      urlKind,
    } as const
    template[field] = placeholder
    placeholders.set(value, placeholder)
  }
  const bodyTemplate = CreateReplaySchema.shape.bodyTemplate.parse(template)
  if (containsAbsoluteUrl(bodyTemplate)) throw new UnrepresentableCreateReplayError()
  const locationTemplate = input.location === undefined ? undefined : placeholders.get(input.location)
  if (input.location !== undefined && locationTemplate === undefined) throw new UnrepresentableCreateReplayError()
  const replay = CreateReplaySchema.parse({
    status: input.status,
    headers: {
      contentType: input.contentType,
      ...(locationTemplate === undefined ? {} : { locationTemplate }),
      ...(input.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: input.retryAfterSeconds }),
    },
    bodyTemplate,
  })
  return { replay, ...(sessionId === undefined ? {} : { sessionId }) }
}
