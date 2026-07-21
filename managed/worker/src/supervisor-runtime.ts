import { randomUUID } from "node:crypto"
import type { Server } from "node:http"
import {
  MANAGED_WORKER_IMAGE_INPUT,
  MANAGED_WORKER_RUNTIME,
} from "./image-policy.js"
import {
  assertNode22Runtime,
  parseWorkerConfig,
  type WorkerConfig,
} from "./config.js"
import {
  createSupervisorProxy,
  type SupervisorProxyConfig,
} from "./supervisor-proxy.js"
import {
  SHUTDOWN_OUTCOME,
  SHUTDOWN_SIGNALS,
  type ShutdownOutcome,
  type SignalControl,
} from "./shutdown.js"
import {
  closeProductionProxy,
  listenProductionProxy,
  prepareProductionRuntime,
  spawnProductionUpstream,
  waitForProductionUpstream,
} from "./upstream-process.js"
import { verifyRuntimeSourceManifest } from "./runtime-source-policy.js"
import type { RuntimeSourceReceipt } from "./runtime-source-policy.js"
import { CreateJournalStore } from "./create-journal-store.js"
import { readProductionBrowserVersion } from "./runtime-browser-readback.js"
import { buildUpstreamEnvironment } from "./upstream-environment.js"

export { buildUpstreamEnvironment } from "./upstream-environment.js"

export type ManagedUpstreamProcess = {
  readonly exited: Promise<void>
  readonly terminate: (signal: NodeJS.Signals) => void
}

export type SupervisorRuntimeDependencies = {
  readonly closeProxy: (server: Server) => Promise<void>
  readonly createJournal: () => CreateJournalStore
  readonly createProxy: (
    config: SupervisorProxyConfig,
    journal: CreateJournalStore,
  ) => Server
  readonly listen: (server: Server) => Promise<void>
  readonly nodeRuntimeVersion: string
  readonly prepareRuntime: () => Promise<void>
  readonly readBrowserVersion: () => Promise<string>
  readonly signals: SignalControl
  readonly spawnUpstream: (
    environment: NodeJS.ProcessEnv,
  ) => ManagedUpstreamProcess
  readonly waitUntilReady: (process: ManagedUpstreamProcess) => Promise<void>
  readonly verifyRuntimeSource: () => Promise<RuntimeSourceReceipt>
}

export type RunningManagedWorkerSupervisor = {
  readonly completion: Promise<ShutdownOutcome>
  readonly identity: {
    readonly instanceId: string
    readonly workerId: WorkerConfig["workerId"]
  }
  readonly server: Server
}

export function productionSupervisorDependencies(
  signals: SignalControl,
): SupervisorRuntimeDependencies {
  return {
    closeProxy: closeProductionProxy,
    createJournal: () => new CreateJournalStore(),
    createProxy: createSupervisorProxy,
    listen: listenProductionProxy,
    nodeRuntimeVersion: process.versions.node,
    prepareRuntime: prepareProductionRuntime,
    readBrowserVersion: readProductionBrowserVersion,
    signals,
    spawnUpstream: spawnProductionUpstream,
    waitUntilReady: waitForProductionUpstream,
    verifyRuntimeSource: verifyRuntimeSourceManifest,
  }
}

export async function startManagedWorkerSupervisor(
  environment: NodeJS.ProcessEnv,
  dependencies: SupervisorRuntimeDependencies,
): Promise<RunningManagedWorkerSupervisor> {
  assertNode22Runtime(dependencies.nodeRuntimeVersion)
  const config = parseWorkerConfig(environment)
  await dependencies.verifyRuntimeSource()
  await dependencies.prepareRuntime()
  const browserVersion = await dependencies.readBrowserVersion()
  const journal = dependencies.createJournal()
  await journal.initialize()
  const identity = {
    instanceId: randomUUID(),
    workerId: config.workerId,
  }
  const upstream = dependencies.spawnUpstream(buildUpstreamEnvironment(environment))
  let server: Server | undefined
  try {
    await dependencies.waitUntilReady(upstream)
    server = dependencies.createProxy({
      browserVersion,
      instanceId: identity.instanceId,
      upstream: {
        address: MANAGED_WORKER_RUNTIME.UPSTREAM_HOST,
        port: MANAGED_WORKER_RUNTIME.UPSTREAM_PORT,
      },
      upstreamSha: MANAGED_WORKER_IMAGE_INPUT.UPSTREAM_REVISION,
      workerId: identity.workerId,
    }, journal)
    await dependencies.listen(server)
  } catch (error) {
    const closing =
      server === undefined ? Promise.resolve() : dependencies.closeProxy(server)
    upstream.terminate("SIGTERM")
    await Promise.allSettled([closing, upstream.exited])
    throw error
  }

  let shutdownStarted = false
  let resolveCompletion: ((outcome: ShutdownOutcome) => void) | undefined
  const completion = new Promise<ShutdownOutcome>((resolve) => {
    resolveCompletion = resolve
  })

  const dispose = (): void => {
    for (const signal of SHUTDOWN_SIGNALS) {
      dependencies.signals.off(signal, handleSignal)
    }
  }

  const finish = (outcome: ShutdownOutcome): void => {
    dispose()
    resolveCompletion?.(outcome)
  }

  const stop = async (): Promise<void> => {
    const closing = dependencies.closeProxy(server)
    upstream.terminate("SIGTERM")
    await Promise.all([closing, upstream.exited])
    finish(SHUTDOWN_OUTCOME.CLOSED)
  }

  function handleSignal(): void {
    if (shutdownStarted) {
      return
    }
    shutdownStarted = true
    void stop().catch(() => {
      dependencies.signals.setExitCode(1)
      finish(SHUTDOWN_OUTCOME.FAILED)
    })
  }

  for (const signal of SHUTDOWN_SIGNALS) {
    dependencies.signals.on(signal, handleSignal)
  }

  void upstream.exited.then(async () => {
    if (shutdownStarted) {
      return
    }
    shutdownStarted = true
    dependencies.signals.setExitCode(1)
    upstream.terminate("SIGTERM")
    await dependencies.closeProxy(server).catch(() => undefined)
    finish(SHUTDOWN_OUTCOME.FAILED)
  })

  return { completion, identity, server }
}
