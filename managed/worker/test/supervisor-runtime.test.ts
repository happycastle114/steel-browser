import type { Server } from "node:http"
import { createServer } from "node:http"
import { rm } from "node:fs/promises"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  buildUpstreamEnvironment,
  startManagedWorkerSupervisor,
  type ManagedUpstreamProcess,
  type SupervisorRuntimeDependencies,
} from "../src/supervisor-runtime.js"
import { deferred, FakeSignalControl, TEST_NODE_RUNTIME_VERSION } from "./test-support.js"
import { buildProductionUpstreamCommand } from "../src/upstream-process.js"
import { CreateJournalStore } from "../src/create-journal-store.js"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { tmpdir } from "node:os"

const journalFiles: string[] = []

afterEach(async () => {
  await Promise.all(journalFiles.splice(0).map((file) => rm(file, { force: true })))
})

function fakeUpstream(): ManagedUpstreamProcess & {
  readonly exitNow: () => void
  readonly terminate: ReturnType<typeof vi.fn>
} {
  const exit = deferred()
  return {
    exited: exit.promise,
    exitNow: exit.resolve,
    terminate: vi.fn(),
  }
}

function runtimeDependencies(input: {
  readonly child: ManagedUpstreamProcess
  readonly createProxy?: () => Server
  readonly events: string[]
  readonly signals: FakeSignalControl
}): SupervisorRuntimeDependencies {
  return {
    closeProxy: async () => {
      input.events.push("close")
    },
    createJournal: () => {
      const file = join(tmpdir(), `steel-runtime-${randomUUID()}.json`)
      journalFiles.push(file)
      return new CreateJournalStore(file)
    },
    createProxy: input.createProxy ?? (() => createServer()),
    listen: async (_server: Server) => {
      input.events.push("listen")
    },
    nodeRuntimeVersion: TEST_NODE_RUNTIME_VERSION,
    prepareRuntime: async () => {
      input.events.push("prepare")
    },
    readBrowserVersion: async () => {
      input.events.push("browser")
      return "140.0.7339.16"
    },
    signals: input.signals,
    spawnUpstream: () => {
      input.events.push("spawn")
      return input.child
    },
    waitUntilReady: async () => {
      input.events.push("ready")
    },
    verifyRuntimeSource: async () => {
      input.events.push("source")
      return {
        fileCount: 1,
        packageLockSha256: "a".repeat(64),
        sourceDateEpoch: "1773013379",
        sourceRevision: "b".repeat(40),
      }
    },
  }
}

describe("managed worker supervisor lifecycle", () => {
  it("starts the private proxy only after upstream health is ready", async () => {
    // Given
    const events: string[] = []
    const child = fakeUpstream()
    const signals = new FakeSignalControl()

    // When
    const runtime = await startManagedWorkerSupervisor(
      { MANAGED_WORKER_ID: "worker-00" },
      runtimeDependencies({ child, events, signals }),
    )

    // Then
    expect(events).toEqual(["source", "prepare", "browser", "spawn", "ready", "listen"])
    expect(runtime.identity.workerId).toBe("worker-00")
    child.exitNow()
    await runtime.completion
  })

  it("stops accepting before terminating upstream and reports a clean signal shutdown", async () => {
    // Given
    const events: string[] = []
    const child = fakeUpstream()
    const signals = new FakeSignalControl()
    const createProxy = (): Server => {
      const server = createServer()
      return server
    }
    const dependencies = runtimeDependencies({ child, createProxy, events, signals })
    child.terminate.mockImplementation(() => {
      events.push("terminate")
      child.exitNow()
    })
    const runtime = await startManagedWorkerSupervisor(
      { MANAGED_WORKER_ID: "worker-01" },
      dependencies,
    )

    // When
    signals.emit("SIGTERM")
    const outcome = await runtime.completion

    // Then
    expect(outcome).toBe("CLOSED")
    expect(events.slice(-2)).toEqual(["close", "terminate"])
    expect(signals.exitCode).toBeUndefined()
  })

  it("fails closed when the upstream process exits unexpectedly", async () => {
    // Given
    const events: string[] = []
    const child = fakeUpstream()
    const signals = new FakeSignalControl()
    const runtime = await startManagedWorkerSupervisor(
      { MANAGED_WORKER_ID: "worker-00" },
      runtimeDependencies({ child, events, signals }),
    )

    // When
    child.exitNow()
    const outcome = await runtime.completion

    // Then
    expect(outcome).toBe("FAILED")
    expect(signals.exitCode).toBe(1)
    expect(child.terminate).toHaveBeenCalledWith("SIGTERM")
  })

  it("reaps upstream when readiness fails before the proxy can listen", async () => {
    // Given
    const events: string[] = []
    const child = fakeUpstream()
    child.terminate.mockImplementation(() => child.exitNow())
    const signals = new FakeSignalControl()
    const dependencies: SupervisorRuntimeDependencies = {
      ...runtimeDependencies({ child, events, signals }),
      waitUntilReady: async () => {
        throw new Error("readiness failed")
      },
    }

    // When
    const start = () =>
      startManagedWorkerSupervisor(
        { MANAGED_WORKER_ID: "worker-00" },
        dependencies,
      )

    // Then
    await expect(start).rejects.toThrow("readiness failed")
    expect(child.terminate).toHaveBeenCalledWith("SIGTERM")
    expect(events).not.toContain("listen")
  })
})

describe("upstream process environment", () => {
  it("runs upstream and descendants in one non-root DBus session process group", () => {
    // Given
    const environment = { TMPDIR: "/tmp" }

    // When
    const command = buildProductionUpstreamCommand(environment)

    // Then
    expect(command).toMatchObject({
      arguments: [
        "/usr/bin/env",
        "TMPDIR=/tmp",
        process.execPath,
        "/app/api/build/index.js",
      ],
      command: "/usr/bin/dbus-run-session",
      environment: { TMPDIR: "/run/steel/runtime" },
    })
  })

  it("replaces external bind and debugger inputs with fixed loopback values", () => {
    // Given
    const environment = {
      CDP_DOMAIN: "attacker.invalid:9223",
      CHROME_ARGS: "--no-sandbox",
      HOST: "0.0.0.0",
      MANAGED_WORKER_ID: "worker-00",
      PATH: "/usr/local/bin:/usr/bin:/bin",
      PORT: "9223",
      STEEL_MANAGED_CREATE_TOKEN_KEY_HEX: "secret",
    }

    // When
    const upstream = buildUpstreamEnvironment(environment)

    // Then
    expect(upstream).toMatchObject({
      CDP_DOMAIN: "127.0.0.1:3000",
      CDP_REDIRECT_PORT: "3000",
      CHROME_ARGS: "--remote-debugging-address=127.0.0.1 --remote-debugging-port=0",
      CHROME_USER_DATA_DIR: "/var/lib/steel/profile",
      HOST: "127.0.0.1",
      FILTER_CHROME_ARGS: "--remote-debugging-address=127.0.0.1 --remote-debugging-port=9222",
      PORT: "3001",
    })
    expect(upstream["MANAGED_WORKER_ID"]).toBeUndefined()
    expect(upstream["STEEL_MANAGED_CREATE_TOKEN_KEY_HEX"]).toBeUndefined()
    expect(upstream["CHROME_ARGS"]).not.toContain("--no-sandbox")
  })
})
