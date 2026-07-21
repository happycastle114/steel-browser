import type { ManagerRuntime } from "./manager-runtime.js"

export const ManagerShutdownSignal = {
  INTERRUPT: "SIGINT",
  TERMINATE: "SIGTERM",
} as const
export type ManagerShutdownSignal =
  (typeof ManagerShutdownSignal)[keyof typeof ManagerShutdownSignal]

export type ManagerProcessPort = Readonly<{
  off(signal: ManagerShutdownSignal, listener: () => void): unknown
  once(signal: ManagerShutdownSignal, listener: () => void): unknown
}>

type ManagerRuntimeLifecyclePort = Pick<ManagerRuntime, "close" | "start">

export async function runManagerRuntimeUntilSignal(
  runtime: ManagerRuntimeLifecyclePort,
  processPort: ManagerProcessPort = process,
): Promise<void> {
  let closePromise: Promise<void> | undefined
  let resolveStopped: (() => void) | undefined
  let rejectStopped: ((error: unknown) => void) | undefined
  let started = false
  let stopRequested = false
  const stopped = new Promise<void>((resolve, reject) => {
    resolveStopped = resolve
    rejectStopped = reject
  })
  const uninstall = (): void => {
    processPort.off(ManagerShutdownSignal.INTERRUPT, requestStop)
    processPort.off(ManagerShutdownSignal.TERMINATE, requestStop)
  }
  const close = (): void => {
    closePromise ??= runtime
      .close()
      .then(
        () => {
          uninstall()
          resolveStopped?.()
        },
        (error: unknown) => {
          uninstall()
          rejectStopped?.(error)
        },
      )
  }
  function requestStop(): void {
    stopRequested = true
    if (started) close()
  }

  processPort.once(ManagerShutdownSignal.INTERRUPT, requestStop)
  processPort.once(ManagerShutdownSignal.TERMINATE, requestStop)
  try {
    await runtime.start()
    started = true
    if (stopRequested) close()
    await stopped
  } catch (error) {
    uninstall()
    throw error
  }
}
