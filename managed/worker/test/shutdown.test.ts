import fastify from "fastify"
import { ShutdownReason } from "@steel-browser/api/cdp-plugin"
import { describe, expect, it } from "vitest"
import { WORKER_META_PATH, parseWorkerConfig } from "../src/config.js"
import { createWorkerApplication } from "../src/server.js"
import {
  SHUTDOWN_OUTCOME,
  installGracefulShutdown,
  type ShutdownRegistration,
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

  it("drives the real Steel CDP cleanup path once on process signals", async () => {
    // Given
    const application = createWorkerApplication(
      parseWorkerConfig({ MANAGED_WORKER_ID: "worker-01" }),
    )
    const signals = new FakeSignalControl()
    let cleanupCount = 0
    const listen = application.server.listen({ host: "127.0.0.1", port: 0 })
    let registration: ShutdownRegistration | undefined

    try {
      await listen
      application.server.registerCDPShutdownHook(() => {
        cleanupCount += 1
      })
      registration = installGracefulShutdown(application.server, signals)
      await expect
        .poll(
          async () =>
            (
              await application.server.inject({
                method: "GET",
                url: WORKER_META_PATH,
              })
            ).statusCode,
          {
            interval: 100,
            timeout: 15_000,
          },
        )
        .toBe(200)
      await expect
        .poll(() => application.server.cdpService.getBrowserProcess(), {
          interval: 100,
          timeout: 15_000,
        })
        .not.toBeNull()

      // When
      signals.emit("SIGTERM")
      signals.emit("SIGINT")
      const outcome = await registration.completion

      // Then
      expect(outcome).toBe(SHUTDOWN_OUTCOME.CLOSED)
      expect(cleanupCount).toBe(1)
      expect(application.server.cdpService.getBrowserProcess()).toBeNull()
    } finally {
      registration?.dispose()
      try {
        await application.server.close()
      } finally {
        if (application.server.cdpService.getBrowserProcess() !== null) {
          await application.server.cdpService.shutdown(ShutdownReason.SESSION_END)
        }
      }
    }
  }, 30_000)
})
