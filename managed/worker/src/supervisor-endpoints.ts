import type { ServerResponse } from "node:http"
import {
  CREATE_JOURNAL_STATE,
  CREATE_JOURNAL_VERSION,
  PRIVATE_SUPERVISOR_ERROR_CODE,
  PRIVATE_SUPERVISOR_JSON_CONTENT_TYPE,
  PRIVATE_SUPERVISOR_RESPONSE_KIND,
  PRIVATE_SUPERVISOR_RETRY_AFTER_HEADER_VALUE,
  PRIVATE_SUPERVISOR_STATUS,
  PrivateSupervisorWireResponseSchema,
  WORKER_IDENTITY_HEADER,
  type CreateReplayRecord,
} from "@happycastle/steel-managed-shared"
import {
  ACTIVE_SESSION_OBSERVATION_KIND,
  observeActiveSession,
} from "./active-session-observer.js"
import { parseCreateToken } from "./create-journal-contract.js"
import type { CreateJournalStore } from "./create-journal-store.js"
import type { SupervisorProxyConfig } from "./supervisor-transport.js"

type WireInput = Readonly<{ body: unknown; kind: string; status: number }>

function sendSupervisorWire(
  response: ServerResponse,
  config: SupervisorProxyConfig,
  input: WireInput,
  retry: boolean = false,
): void {
  if (response.destroyed || response.headersSent) return
  const bodyJson = JSON.stringify(input.body)
  const wire = PrivateSupervisorWireResponseSchema.parse({
    ...input,
    headers: {
      [WORKER_IDENTITY_HEADER.INSTANCE_ID]: config.instanceId,
      [WORKER_IDENTITY_HEADER.WORKER_ID]: config.workerId,
      "content-length": String(Buffer.byteLength(bodyJson)),
      "content-type": PRIVATE_SUPERVISOR_JSON_CONTENT_TYPE,
      ...(retry ? { "retry-after": PRIVATE_SUPERVISOR_RETRY_AFTER_HEADER_VALUE } : {}),
    },
  })
  response.writeHead(wire.status, wire.headers)
  response.end(bodyJson)
}

export function sendSupervisorMetadata(
  response: ServerResponse,
  config: SupervisorProxyConfig,
): void {
  sendSupervisorWire(response, config, {
    body: {
      browserVersion: config.browserVersion,
      instanceId: config.instanceId,
      journalVersion: CREATE_JOURNAL_VERSION,
      upstreamSha: config.upstreamSha,
      workerId: config.workerId,
    },
    kind: PRIVATE_SUPERVISOR_RESPONSE_KIND.META,
    status: PRIVATE_SUPERVISOR_STATUS.OK,
  })
}

function pending(record: CreateReplayRecord): boolean {
  return record.state === CREATE_JOURNAL_STATE.ACCEPTED ||
    record.state === CREATE_JOURNAL_STATE.UPSTREAM_PENDING ||
    record.state === CREATE_JOURNAL_STATE.UNCERTAIN
}

function sendObservationUnavailable(response: ServerResponse, config: SupervisorProxyConfig): void {
  sendSupervisorWire(response, config, {
    body: { code: PRIVATE_SUPERVISOR_ERROR_CODE.UPSTREAM_OBSERVATION_UNAVAILABLE },
    kind: PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_ACTIVE_ERROR,
    status: PRIVATE_SUPERVISOR_STATUS.UNAVAILABLE,
  })
}

export async function sendSupervisorActiveCreates(
  response: ServerResponse,
  config: SupervisorProxyConfig,
  journal: CreateJournalStore,
): Promise<void> {
  const observation = await observeActiveSession(config.upstream)
  if (observation.kind === ACTIVE_SESSION_OBSERVATION_KIND.UNAVAILABLE) {
    sendObservationUnavailable(response, config)
    return
  }
  try {
    await journal.reconcileActiveSession(observation.session?.id ?? null)
    sendSupervisorWire(response, config, {
      body: { creates: await journal.active() },
      kind: PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_ACTIVE,
      status: PRIVATE_SUPERVISOR_STATUS.OK,
    })
  } catch {
    sendObservationUnavailable(response, config)
  }
}

function sendCreateNotFound(response: ServerResponse, config: SupervisorProxyConfig): void {
  sendSupervisorWire(response, config, {
    body: { code: PRIVATE_SUPERVISOR_ERROR_CODE.CREATE_NOT_FOUND },
    kind: PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_TOKEN_ERROR,
    status: PRIVATE_SUPERVISOR_STATUS.NOT_FOUND,
  })
}

export async function sendSupervisorCreateLookup(
  response: ServerResponse,
  config: SupervisorProxyConfig,
  journal: CreateJournalStore,
  encodedToken: string,
): Promise<void> {
  let token: string
  try {
    token = parseCreateToken(decodeURIComponent(encodedToken))
  } catch {
    sendCreateNotFound(response, config)
    return
  }
  const record = await journal.lookup(token)
  if (record === undefined) {
    sendCreateNotFound(response, config)
    return
  }
  const isPending = pending(record)
  sendSupervisorWire(response, config, {
    body: record,
    kind: isPending
      ? PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_TOKEN_PENDING
      : PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_TOKEN_COMPLETE,
    status: isPending ? PRIVATE_SUPERVISOR_STATUS.PENDING : PRIVATE_SUPERVISOR_STATUS.OK,
  }, isPending)
}
