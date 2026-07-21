import type { IncomingMessage, ServerResponse } from "node:http"
import {
  CREATE_JOURNAL_POLICY,
  CREATE_JOURNAL_STATE,
  JOURNAL_ACCEPT_RESULT,
  hasManagedCreateHeaders,
  parseManagedCreateContext,
  type JournalAcceptOutcome,
} from "./create-journal-contract.js"
import type { CreateJournalStore } from "./create-journal-store.js"
import {
  sendCreateJson,
  sendCreateRecord,
} from "./create-journal-response.js"
import { runUpstreamCreate } from "./create-upstream-transaction.js"
import type { SupervisorProxyConfig } from "./supervisor-transport.js"
import { WORKER_HTTP_METHOD } from "./config.js"

const CREATE_PATH = "/v1/sessions" as const
const CREATE_HTTP_ERROR = {
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  JOURNAL_UNAVAILABLE: "WORKER_JOURNAL_UNAVAILABLE",
} as const

function collectBody(incoming: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let length = 0
    let settled = false
    incoming.on("data", (chunk: Buffer) => {
      if (settled) return
      length += chunk.byteLength
      if (length > CREATE_JOURNAL_POLICY.CREATE_BODY_BYTES) {
        settled = true
        chunks.length = 0
        reject(new RangeError("managed create body exceeds the fixed bound"))
      } else {
        chunks.push(chunk)
      }
    })
    incoming.on("end", () => {
      if (!settled) {
        settled = true
        resolve(Buffer.concat(chunks))
      }
    })
    incoming.on("aborted", () => {
      if (!settled) {
        settled = true
        reject(new Error("managed create request aborted"))
      }
    })
    incoming.on("error", (error) => {
      if (!settled) {
        settled = true
        reject(error)
      }
    })
  })
}

export function isJournaledCreate(incoming: IncomingMessage): boolean {
  return incoming.method === WORKER_HTTP_METHOD.POST &&
    incoming.url === CREATE_PATH &&
    hasManagedCreateHeaders(incoming)
}

export async function handleJournaledCreate(
  incoming: IncomingMessage,
  response: ServerResponse,
  config: SupervisorProxyConfig,
  journal: CreateJournalStore,
): Promise<void> {
  let context
  let body
  try {
    context = parseManagedCreateContext(incoming)
    body = await collectBody(incoming)
  } catch {
    sendCreateJson(response, config, 400, { code: CREATE_HTTP_ERROR.INVALID_ARGUMENT })
    return
  }
  let accepted: JournalAcceptOutcome
  try {
    accepted = await journal.accept(context)
  } catch {
    sendCreateJson(response, config, 503, {
      code: CREATE_HTTP_ERROR.JOURNAL_UNAVAILABLE,
    })
    return
  }
  switch (accepted.kind) {
    case JOURNAL_ACCEPT_RESULT.ACCEPTED:
      runUpstreamCreate(incoming, response, body, context.token, journal, config)
      return
    case JOURNAL_ACCEPT_RESULT.DUPLICATE:
      if (accepted.record.state === CREATE_JOURNAL_STATE.ACCEPTED) {
        runUpstreamCreate(incoming, response, body, context.token, journal, config)
      } else {
        sendCreateRecord(response, config, accepted.record)
      }
      return
    case JOURNAL_ACCEPT_RESULT.CONFLICT:
      sendCreateJson(response, config, 409, { code: "CREATE_TOKEN_CONFLICT" })
      return
    case JOURNAL_ACCEPT_RESULT.CAPACITY:
    case JOURNAL_ACCEPT_RESULT.WORKER_BUSY:
      sendCreateJson(response, config, 503, { code: "WORKER_JOURNAL_CAPACITY" })
      return
    default: {
      const exhaustive: never = accepted
      return exhaustive
    }
  }
}
