import type { FastifyInstance } from "fastify"

export const SHUTDOWN_SIGNALS = ["SIGTERM", "SIGINT"] as const
export type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number]

export const SHUTDOWN_OUTCOME = {
  CLOSED: "CLOSED",
  FAILED: "FAILED",
} as const
export type ShutdownOutcome = (typeof SHUTDOWN_OUTCOME)[keyof typeof SHUTDOWN_OUTCOME]

export interface SignalControl {
  on(signal: ShutdownSignal, listener: () => void): void
  off(signal: ShutdownSignal, listener: () => void): void
  setExitCode(code: number): void
}

export type ShutdownRegistration = {
  readonly completion: Promise<ShutdownOutcome>
  readonly dispose: () => void
}

class UnknownWorkerShutdownError extends Error {
  override readonly name = "UnknownWorkerShutdownError"

  constructor(cause: unknown) {
    super("worker shutdown failed with a non-Error value", { cause })
  }
}

export function installGracefulShutdown(
  server: FastifyInstance,
  signals: SignalControl,
): ShutdownRegistration {
  let shutdownStarted = false
  let resolveCompletion: ((outcome: ShutdownOutcome) => void) | undefined
  const completion = new Promise<ShutdownOutcome>((resolve) => {
    resolveCompletion = resolve
  })

  function dispose(): void {
    for (const signal of SHUTDOWN_SIGNALS) {
      signals.off(signal, handleSignal)
    }
  }

  async function closeServer(): Promise<void> {
    try {
      await server.close()
      resolveCompletion?.(SHUTDOWN_OUTCOME.CLOSED)
    } catch (error) {
      const failure =
        error instanceof Error ? error : new UnknownWorkerShutdownError(error)
      server.log.error({ err: failure }, "worker.shutdown.failed")
      signals.setExitCode(1)
      resolveCompletion?.(SHUTDOWN_OUTCOME.FAILED)
    } finally {
      dispose()
    }
  }

  function handleSignal(): void {
    if (shutdownStarted) {
      return
    }
    shutdownStarted = true
    void closeServer()
  }

  for (const signal of SHUTDOWN_SIGNALS) {
    signals.on(signal, handleSignal)
  }

  return { completion, dispose }
}
