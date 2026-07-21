import {
  request as createUpstreamRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import { z } from "zod"
import {
  CREATE_JOURNAL_POLICY,
  CREATE_JOURNAL_STATE,
} from "./create-journal-contract.js"
import type { CreateJournalStore } from "./create-journal-store.js"
import { sendCreateJson } from "./create-journal-response.js"
import {
  buildCreateReplay,
  UnrepresentableCreateReplayError,
} from "./create-replay-template.js"
import {
  sanitizeProxyHeaders,
  supervisorIdentityHeaders,
  type SupervisorProxyConfig,
} from "./supervisor-transport.js"

const CREATE_STATUS = {
  FAILED_MINIMUM: 400,
  LIVE_MAXIMUM: 299,
  LIVE_MINIMUM: 200,
} as const
const CREATE_UPSTREAM_ERROR = {
  JOURNAL_UNAVAILABLE: "WORKER_JOURNAL_UNAVAILABLE",
  UPSTREAM_UNAVAILABLE: "WORKER_UPSTREAM_UNAVAILABLE",
} as const

async function finishJournal(
  journal: CreateJournalStore,
  token: string,
  status: number,
  headers: IncomingMessage["headers"],
  body: Buffer,
): Promise<void> {
  if (body.byteLength > CREATE_JOURNAL_POLICY.RECORD_BYTES) {
    await journal.markUncertain(token)
    return
  }
  try {
    const represented = buildCreateReplay(status, headers, body)
    if (status >= CREATE_STATUS.LIVE_MINIMUM && status <= CREATE_STATUS.LIVE_MAXIMUM) {
      if (represented.sessionId === undefined) {
        await journal.markUncertain(token)
        return
      }
      await journal.complete(
        token,
        CREATE_JOURNAL_STATE.LIVE,
        represented.replay,
        represented.sessionId,
      )
      return
    }
    if (
      status >= CREATE_STATUS.FAILED_MINIMUM &&
      represented.sessionId === undefined
    ) {
      await journal.complete(
        token,
        CREATE_JOURNAL_STATE.FAILED_TERMINAL,
        represented.replay,
      )
      return
    }
    await journal.markUncertain(token)
  } catch (error) {
    if (error instanceof UnrepresentableCreateReplayError || error instanceof z.ZodError) {
      await journal.markUncertain(token)
      return
    }
    throw error
  }
}

function capturedBody(chunks: readonly Buffer[], length: number): Buffer {
  return length > CREATE_JOURNAL_POLICY.RECORD_BYTES
    ? Buffer.alloc(CREATE_JOURNAL_POLICY.RECORD_BYTES + 1)
    : Buffer.concat(chunks)
}

export function runUpstreamCreate(
  incoming: IncomingMessage,
  response: ServerResponse,
  body: Buffer,
  token: string,
  journal: CreateJournalStore,
  config: SupervisorProxyConfig,
): void {
  void journal.markPending(token).then(() => {
    const outgoing = createUpstreamRequest(
      {
        headers: sanitizeProxyHeaders(incoming.headers),
        host: config.upstream.address,
        method: incoming.method,
        path: incoming.url,
        port: config.upstream.port,
        timeout: CREATE_JOURNAL_POLICY.CREATE_TIMEOUT_MS,
      },
      (upstreamResponse) => {
        const chunks: Buffer[] = []
        let length = 0
        if (!response.destroyed) {
          response.writeHead(upstreamResponse.statusCode ?? 502, {
            ...sanitizeProxyHeaders(upstreamResponse.headers),
            ...supervisorIdentityHeaders(config),
          })
        }
        upstreamResponse.on("data", (chunk: Buffer) => {
          length += chunk.byteLength
          if (length <= CREATE_JOURNAL_POLICY.RECORD_BYTES + 1) chunks.push(chunk)
          if (!response.destroyed) response.write(chunk)
        })
        upstreamResponse.on("end", () => {
          if (!response.destroyed) response.end()
          void finishJournal(
            journal,
            token,
            upstreamResponse.statusCode ?? 502,
            upstreamResponse.headers,
            capturedBody(chunks, length),
          ).catch(() => journal.markUncertain(token).catch(() => undefined))
        })
        upstreamResponse.on("error", () => {
          if (!response.destroyed) response.destroy()
          void journal.markUncertain(token).catch(() => undefined)
        })
      },
    )
    outgoing.on("timeout", () => outgoing.destroy())
    outgoing.on("error", () => {
      void journal.markUncertain(token).catch(() => undefined)
      sendCreateJson(response, config, 502, {
        code: CREATE_UPSTREAM_ERROR.UPSTREAM_UNAVAILABLE,
      })
    })
    outgoing.end(body)
  }).catch(() => {
    sendCreateJson(response, config, 503, {
      code: CREATE_UPSTREAM_ERROR.JOURNAL_UNAVAILABLE,
    })
  })
}
