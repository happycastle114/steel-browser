import {
  CreateReplaySchema,
  PUBLIC_URL_KIND,
  PublicUrlPlaceholderSchema,
  type CreateBodyTemplate,
  type CreateReplay,
} from "./create-replay-contract.js"
import type { SelectedPublicOrigin } from "./public-urls.js"

const PUBLIC_REPLAY_PATH = {
  DEBUG: "/v1/sessions/debug",
  DEVTOOLS: "/v1/devtools/inspector.html",
  VIEWER: "/",
  WEBSOCKET: "/",
} as const

export type RenderedCreateReplay = Readonly<{
  status: number
  headers: Readonly<{
    contentLength: number
    contentType?: string
    location?: string
    retryAfterSeconds?: number
  }>
  body: CreateBodyTemplate
  bodyJson: string
}>

function renderPublicUrl(
  placeholder: ReturnType<typeof PublicUrlPlaceholderSchema.parse>,
  origin: SelectedPublicOrigin,
): string {
  let path: string
  switch (placeholder.urlKind) {
    case PUBLIC_URL_KIND.DEBUG:
      path = PUBLIC_REPLAY_PATH.DEBUG
      break
    case PUBLIC_URL_KIND.DEVTOOLS:
      path = PUBLIC_REPLAY_PATH.DEVTOOLS
      break
    case PUBLIC_URL_KIND.VIEWER:
      path = PUBLIC_REPLAY_PATH.VIEWER
      break
    case PUBLIC_URL_KIND.WEBSOCKET:
      path = PUBLIC_REPLAY_PATH.WEBSOCKET
      break
  }
  const rendered = new URL(path, origin)
  if (placeholder.urlKind === PUBLIC_URL_KIND.WEBSOCKET) rendered.protocol = "wss:"
  return rendered.href
}

function renderTemplate(value: CreateBodyTemplate, origin: SelectedPublicOrigin): CreateBodyTemplate {
  if (Array.isArray(value)) return value.map((nested) => renderTemplate(nested, origin))
  if (value === null || typeof value !== "object") return value
  const placeholder = PublicUrlPlaceholderSchema.safeParse(value)
  if (placeholder.success) return renderPublicUrl(placeholder.data, origin)
  const rendered: Record<string, CreateBodyTemplate> = {}
  for (const [key, nested] of Object.entries(value)) rendered[key] = renderTemplate(nested, origin)
  return rendered
}

export function renderCreateReplay(
  replayInput: CreateReplay,
  originInput: SelectedPublicOrigin,
): RenderedCreateReplay {
  const replay = CreateReplaySchema.parse(replayInput)
  const body = renderTemplate(replay.bodyTemplate, originInput)
  const bodyJson = JSON.stringify(body)
  const location = replay.headers.locationTemplate === undefined
    ? undefined
    : renderPublicUrl(replay.headers.locationTemplate, originInput)
  return Object.freeze({
    status: replay.status,
    headers: Object.freeze({
      contentLength: new TextEncoder().encode(bodyJson).byteLength,
      ...(replay.headers.contentType === undefined ? {} : { contentType: replay.headers.contentType }),
      ...(location === undefined ? {} : { location }),
      ...(replay.headers.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: replay.headers.retryAfterSeconds }),
    }),
    body,
    bodyJson,
  })
}
