import type { SignalControl, ShutdownSignal } from "../src/shutdown.js"

export const TEST_NODE_RUNTIME_VERSION = "22.23.1" as const

export class FakeSignalControl implements SignalControl {
  private readonly listeners = new Map<ShutdownSignal, Set<() => void>>()
  exitCode: number | undefined

  on(signal: ShutdownSignal, listener: () => void): void {
    const listeners = this.listeners.get(signal) ?? new Set<() => void>()
    listeners.add(listener)
    this.listeners.set(signal, listeners)
  }

  off(signal: ShutdownSignal, listener: () => void): void {
    this.listeners.get(signal)?.delete(listener)
  }

  setExitCode(code: number): void {
    this.exitCode = code
  }

  emit(signal: ShutdownSignal): void {
    for (const listener of this.listeners.get(signal) ?? []) {
      listener()
    }
  }

  listenerCount(signal: ShutdownSignal): number {
    return this.listeners.get(signal)?.size ?? 0
  }
}

export function deferred(): {
  readonly promise: Promise<void>
  readonly resolve: () => void
} {
  let resolvePromise: (() => void) | undefined
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve: () => resolvePromise?.(),
  }
}
