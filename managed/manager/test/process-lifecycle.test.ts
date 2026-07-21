import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import {
  ManagerShutdownSignal,
  runManagerRuntimeUntilSignal,
  type ManagerProcessPort,
} from "../src/runtime/process-lifecycle.js"

class FakeProcessPort extends EventEmitter implements ManagerProcessPort {
  public override off(signal: ManagerShutdownSignal, listener: () => void): this {
    return super.off(signal, listener)
  }

  public override once(signal: ManagerShutdownSignal, listener: () => void): this {
    return super.once(signal, listener)
  }
}

describe("manager process lifecycle", () => {
  it.each([
    ManagerShutdownSignal.INTERRUPT,
    ManagerShutdownSignal.TERMINATE,
  ])("closes once and removes both handlers for %s", async (signal) => {
    const processPort = new FakeProcessPort()
    const runtime = {
      close: vi.fn(async () => undefined),
      start: vi.fn(async () => undefined),
    }
    const running = runManagerRuntimeUntilSignal(runtime, processPort)
    await vi.waitFor(() => expect(runtime.start).toHaveBeenCalledOnce())

    processPort.emit(signal)
    processPort.emit(signal)
    await running

    expect(runtime.close).toHaveBeenCalledOnce()
    expect(processPort.listenerCount(ManagerShutdownSignal.INTERRUPT)).toBe(0)
    expect(processPort.listenerCount(ManagerShutdownSignal.TERMINATE)).toBe(0)
  })

  it("honors a stop requested while startup is pending", async () => {
    const processPort = new FakeProcessPort()
    let finishStartup: (() => void) | undefined
    const runtime = {
      close: vi.fn(async () => undefined),
      start: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishStartup = resolve
          }),
      ),
    }
    const running = runManagerRuntimeUntilSignal(runtime, processPort)
    await vi.waitFor(() => expect(runtime.start).toHaveBeenCalledOnce())

    processPort.emit(ManagerShutdownSignal.TERMINATE)
    expect(runtime.close).not.toHaveBeenCalled()
    finishStartup?.()
    await running

    expect(runtime.close).toHaveBeenCalledOnce()
  })

  it("removes handlers when startup fails", async () => {
    const processPort = new FakeProcessPort()
    const failure = new Error("startup failed")
    const runtime = {
      close: vi.fn(async () => undefined),
      start: vi.fn(async () => {
        throw failure
      }),
    }

    await expect(runManagerRuntimeUntilSignal(runtime, processPort)).rejects.toBe(failure)
    expect(runtime.close).not.toHaveBeenCalled()
    expect(processPort.listenerCount(ManagerShutdownSignal.INTERRUPT)).toBe(0)
    expect(processPort.listenerCount(ManagerShutdownSignal.TERMINATE)).toBe(0)
  })
})
