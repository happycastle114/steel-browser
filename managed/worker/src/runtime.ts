import type { FastifyInstance } from "fastify"
import {
  WORKER_BIND_ADDRESS,
  assertNode22Runtime,
  parseWorkerConfig,
} from "./config.js"
import {
  createWorkerApplication,
  type WorkerIdentity,
  type WorkerServerDependencies,
} from "./server.js"
import {
  installGracefulShutdown,
  type ShutdownRegistration,
  type SignalControl,
} from "./shutdown.js"

export type WorkerRuntimeDependencies = {
  readonly nodeRuntimeVersion: string
  readonly server?: WorkerServerDependencies
  readonly signals: SignalControl
}

export type RunningWorker = {
  readonly identity: WorkerIdentity
  readonly server: FastifyInstance
  readonly shutdown: ShutdownRegistration
}

export async function startWorker(
  environment: NodeJS.ProcessEnv,
  dependencies: WorkerRuntimeDependencies,
): Promise<RunningWorker> {
  assertNode22Runtime(dependencies.nodeRuntimeVersion)
  const application = createWorkerApplication(
    parseWorkerConfig(environment),
    dependencies.server,
  )
  const shutdown = installGracefulShutdown(application.server, dependencies.signals)

  try {
    await application.server.listen(WORKER_BIND_ADDRESS)
  } catch (error) {
    shutdown.dispose()
    await application.server.close()
    throw error
  }

  return {
    identity: application.identity,
    server: application.server,
    shutdown,
  }
}
