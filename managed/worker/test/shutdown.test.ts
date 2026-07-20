import fastify from "fastify"
import { describe, expect, it } from "vitest"
import {
  SHUTDOWN_OUTCOME,
  installGracefulShutdown,
} from "../src/shutdown.js"
import { FakeSignalControl } from "./test-support.js"

describe("installGracefulShutdown", () => {
  it("closes the server once when both shutdown signals arrive", async () => {
    // Given
    const server = fastify()
    const signals = new FakeSignalControl()
    let closeCount = 0
    server.addHook("onClose", async () => {
      closeCount += 1
    })
    await server.ready()
    const registration = installGracefulShutdown(server, signals)

    // When
    signals.emit("SIGTERM")
    signals.emit("SIGINT")
    const outcome = await registration.completion

    // Then
    expect(outcome).toBe(SHUTDOWN_OUTCOME.CLOSED)
    expect(closeCount).toBe(1)
    expect(signals.exitCode).toBeUndefined()
    expect(signals.listenerCount("SIGTERM")).toBe(0)
    expect(signals.listenerCount("SIGINT")).toBe(0)
  })

  it("disposes both signal handlers before shutdown", async () => {
    // Given
    const server = fastify()
    const signals = new FakeSignalControl()
    await server.ready()
    const registration = installGracefulShutdown(server, signals)

    // When
    registration.dispose()

    // Then
    expect(signals.listenerCount("SIGTERM")).toBe(0)
    expect(signals.listenerCount("SIGINT")).toBe(0)
    await server.close()
  })
})
