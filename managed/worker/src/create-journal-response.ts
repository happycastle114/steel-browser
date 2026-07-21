import type { ServerResponse } from "node:http"
import {
  CREATE_JOURNAL_POLICY,
  CREATE_JOURNAL_STATE,
  type CreateReplayRecord,
} from "./create-journal-contract.js"
import {
  supervisorIdentityHeaders,
  type SupervisorProxyConfig,
} from "./supervisor-transport.js"

export function sendCreateJson(
  response: ServerResponse,
  config: SupervisorProxyConfig,
  status: number,
  body: unknown,
  retryAfter?: number,
): void {
  if (response.destroyed || response.headersSent) return
  const bytes = Buffer.from(JSON.stringify(body))
  response.writeHead(status, {
    ...supervisorIdentityHeaders(config),
    "content-length": String(bytes.byteLength),
    "content-type": "application/json; charset=utf-8",
    ...(retryAfter === undefined ? {} : { "retry-after": String(retryAfter) }),
  })
  response.end(bytes)
}

export function sendCreateRecord(
  response: ServerResponse,
  config: SupervisorProxyConfig,
  record: CreateReplayRecord,
): void {
  const pending = record.state === CREATE_JOURNAL_STATE.ACCEPTED ||
    record.state === CREATE_JOURNAL_STATE.UPSTREAM_PENDING ||
    record.state === CREATE_JOURNAL_STATE.UNCERTAIN
  sendCreateJson(
    response,
    config,
    pending ? 202 : 200,
    record,
    pending ? CREATE_JOURNAL_POLICY.PROBE_RETRY_AFTER_SECONDS : undefined,
  )
}
