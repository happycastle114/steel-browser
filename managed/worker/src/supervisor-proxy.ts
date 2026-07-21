import { createServer, type Server } from "node:http"
import {
  WORKER_ACTIVE_CREATES_PATH,
  WORKER_CREATE_LOOKUP_PREFIX,
  WORKER_HTTP_METHOD,
  WORKER_META_PATH,
} from "./config.js"
import {
  sendSupervisorActiveCreates,
  sendSupervisorCreateLookup,
  sendSupervisorMetadata,
} from "./supervisor-endpoints.js"
import { isJournaledCreate, handleJournaledCreate } from "./create-journal-http.js"
import type { CreateJournalStore } from "./create-journal-store.js"
import {
  createSupervisorTransport,
  type SupervisorProxyConfig,
} from "./supervisor-transport.js"

export type { SupervisorProxyConfig } from "./supervisor-transport.js"

export function createSupervisorProxy(
  config: SupervisorProxyConfig,
  journal: CreateJournalStore,
): Server {
  const transport = createSupervisorTransport(config)
  const server = createServer((incoming, response) => {
    if (
      incoming.method === WORKER_HTTP_METHOD.GET &&
      incoming.url === WORKER_META_PATH
    ) {
      sendSupervisorMetadata(response, config)
      return
    }
    if (
      incoming.method === WORKER_HTTP_METHOD.GET &&
      incoming.url === WORKER_ACTIVE_CREATES_PATH
    ) {
      void sendSupervisorActiveCreates(response, config, journal)
      return
    }
    if (
      incoming.method === WORKER_HTTP_METHOD.GET &&
      incoming.url?.startsWith(WORKER_CREATE_LOOKUP_PREFIX) === true
    ) {
      void sendSupervisorCreateLookup(
        response,
        config,
        journal,
        incoming.url.slice(WORKER_CREATE_LOOKUP_PREFIX.length),
      )
      return
    }
    if (isJournaledCreate(incoming)) {
      void handleJournaledCreate(incoming, response, config, journal)
      return
    }
    transport.proxyHttp(incoming, response)
  })
  server.on("upgrade", (incoming, socket, head) => {
    transport.proxyUpgrade(incoming, socket, head)
  })
  return server
}
