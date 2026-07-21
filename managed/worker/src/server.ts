import { randomUUID } from "node:crypto"
import fastifyCors from "@fastify/cors"
import fastifySensible from "@fastify/sensible"
import { ShutdownReason } from "@steel-browser/api/cdp-plugin"
import steelBrowserPlugin, {
  type SteelBrowserConfig,
} from "@steel-browser/api/plugin"
import fastify, {
  type FastifyInstance,
  type FastifyPlugin,
} from "fastify"
import { z } from "zod"
import {
  WORKER_BOOT_STATUS,
  WORKER_IDENTITY_HEADER,
  WORKER_META_PATH,
  type WorkerBootStatus,
  type WorkerConfig,
} from "./config.js"

const UPSTREAM_BODY_LIMIT_BYTES = 100 * 1024 * 1024
const UuidV4Schema = z
  .string()
  .uuid()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)

const InstanceIdSchema = UuidV4Schema.brand("WorkerInstanceId")

export type WorkerInstanceId = z.infer<typeof InstanceIdSchema>

export type WorkerIdentity = {
  readonly workerId: WorkerConfig["workerId"]
  readonly instanceId: WorkerInstanceId
}

export type WorkerServerDependencies = {
  readonly createInstanceId: () => string
  readonly shutdownUpstream: (server: FastifyInstance) => Promise<void>
  readonly upstreamPlugin: FastifyPlugin<SteelBrowserConfig>
}

export type WorkerApplication = {
  readonly identity: WorkerIdentity
  readonly server: FastifyInstance
}

/** Mutable bootstrap state; mutation is its single lifecycle purpose. */
type WorkerBootstrap = {
  status: WorkerBootStatus
}

const DEFAULT_DEPENDENCIES: WorkerServerDependencies = {
  createInstanceId: randomUUID,
  shutdownUpstream: async (server) => {
    await server.cdpService.shutdown(ShutdownReason.SESSION_END)
  },
  upstreamPlugin: steelBrowserPlugin,
}

export function createWorkerApplication(
  config: WorkerConfig,
  dependencies: WorkerServerDependencies = DEFAULT_DEPENDENCIES,
): WorkerApplication {
  const identity: WorkerIdentity = {
    instanceId: InstanceIdSchema.parse(dependencies.createInstanceId()),
    workerId: config.workerId,
  }
  const bootstrap: WorkerBootstrap = {
    status: WORKER_BOOT_STATUS.BOOTSTRAPPING,
  }
  const server = fastify({
    bodyLimit: UPSTREAM_BODY_LIMIT_BYTES,
    disableRequestLogging: true,
    logger: true,
    trustProxy: false,
  })

  server.addHook("onRequest", async (_request, reply) => {
    reply.header(WORKER_IDENTITY_HEADER.WORKER_ID, identity.workerId)
    reply.header(WORKER_IDENTITY_HEADER.INSTANCE_ID, identity.instanceId)
  })

  server.register(fastifySensible)
  server.register(fastifyCors, { origin: true })
  server.register(dependencies.upstreamPlugin, {
    fileStorage: { maxSizePerSession: UPSTREAM_BODY_LIMIT_BYTES },
  })

  server.register(async function workerLifecyclePlugin(lifecycleServer) {
    lifecycleServer.addHook("onListen", async () => {
      bootstrap.status = WORKER_BOOT_STATUS.READY
    })
    lifecycleServer.addHook("onClose", async () => {
      await dependencies.shutdownUpstream(server)
    })
  })

  server.get(WORKER_META_PATH, async (_request, reply) => {
    switch (bootstrap.status) {
      case WORKER_BOOT_STATUS.BOOTSTRAPPING:
        return reply.code(503).send({
          instanceId: identity.instanceId,
          status: WORKER_BOOT_STATUS.BOOTSTRAPPING,
          workerId: identity.workerId,
        })
      case WORKER_BOOT_STATUS.READY:
        return reply.send({
          instanceId: identity.instanceId,
          status: WORKER_BOOT_STATUS.READY,
          workerId: identity.workerId,
        })
      default: {
        const exhaustiveStatus: never = bootstrap.status
        return exhaustiveStatus
      }
    }
  })

  return { identity, server }
}
