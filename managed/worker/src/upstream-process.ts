import { spawn } from "node:child_process"
import { chmod, mkdir } from "node:fs/promises"
import { get, type Server } from "node:http"
import {
  MANAGED_WORKER_RUNTIME,
} from "./image-policy.js"
import type { ManagedUpstreamProcess } from "./supervisor-runtime.js"
import { SHUTDOWN_SIGNAL } from "./shutdown.js"

const UPSTREAM_ENTRYPOINT = "/app/api/build/index.js"
const DBUS_RUN_SESSION = "/usr/bin/dbus-run-session"
const ENV_COMMAND = "/usr/bin/env"
const DBUS_RUNTIME_DIRECTORY = "/run/steel/runtime"
const UPSTREAM_READY_ATTEMPTS = 180
const UPSTREAM_READY_INTERVAL_MS = 500
const UPSTREAM_SHUTDOWN_GRACE_MS = 45_000
const PROCESS_ERROR_CODE = {
  NO_SUCH_PROCESS: "ESRCH",
} as const
const RUNTIME_DIRECTORIES = [
  DBUS_RUNTIME_DIRECTORY,
  "/tmp/cache",
  "/tmp/files",
  "/tmp/home",
] as const

export type ProductionUpstreamCommand = {
  readonly arguments: readonly string[]
  readonly command: string
  readonly environment: NodeJS.ProcessEnv
}

export function buildProductionUpstreamCommand(
  environment: NodeJS.ProcessEnv,
): ProductionUpstreamCommand {
  return {
    arguments: [
      ENV_COMMAND,
      "TMPDIR=/tmp",
      process.execPath,
      UPSTREAM_ENTRYPOINT,
    ],
    command: DBUS_RUN_SESSION,
    environment: {
      ...environment,
      TMPDIR: DBUS_RUNTIME_DIRECTORY,
    },
  }
}

class UpstreamReadinessError extends Error {
  override readonly name = "UpstreamReadinessError"

  constructor() {
    super("upstream Steel did not become ready before the fixed deadline")
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

function probeUpstreamHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (healthy: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      resolve(healthy)
    }
    const outgoing = get(
      {
        host: MANAGED_WORKER_RUNTIME.UPSTREAM_HOST,
        path: "/v1/health",
        port: MANAGED_WORKER_RUNTIME.UPSTREAM_PORT,
        timeout: UPSTREAM_READY_INTERVAL_MS,
      },
      (response) => {
        response.resume()
        response.on("end", () => finish(response.statusCode === 200))
        response.on("error", () => finish(false))
      },
    )
    outgoing.on("timeout", () => {
      finish(false)
      outgoing.destroy()
    })
    outgoing.on("close", () => finish(false))
    outgoing.on("error", () => finish(false))
  })
}

export function spawnProductionUpstream(
  environment: NodeJS.ProcessEnv,
): ManagedUpstreamProcess {
  const command = buildProductionUpstreamCommand(environment)
  const child = spawn(command.command, command.arguments, {
    detached: true,
    env: command.environment,
    stdio: "inherit",
  })
  let shutdownTimer: NodeJS.Timeout | undefined
  const exited = new Promise<void>((resolve) => {
    const finish = (): void => {
      if (shutdownTimer !== undefined) {
        clearTimeout(shutdownTimer)
      }
      resolve()
    }
    child.once("error", finish)
    child.once("exit", finish)
  })
  const terminateProcessGroup = (signal: NodeJS.Signals): void => {
    const processId = child.pid
    if (processId === undefined) {
      child.kill(signal)
      return
    }
    try {
      process.kill(-processId, signal)
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== PROCESS_ERROR_CODE.NO_SUCH_PROCESS
      ) {
        child.kill(signal)
      }
    }
  }
  return {
    exited,
    terminate: (signal) => {
      terminateProcessGroup(signal)
      if (signal === SHUTDOWN_SIGNAL.TERMINATE) {
        shutdownTimer = setTimeout(
          () => terminateProcessGroup("SIGKILL"),
          UPSTREAM_SHUTDOWN_GRACE_MS,
        )
        shutdownTimer.unref()
      }
    },
  }
}

export async function prepareProductionRuntime(): Promise<void> {
  for (const directory of RUNTIME_DIRECTORIES) {
    await mkdir(directory, { mode: 0o700, recursive: true })
    await chmod(directory, 0o700)
  }
}

export async function waitForProductionUpstream(
  process: ManagedUpstreamProcess,
): Promise<void> {
  let processExited = false
  void process.exited.then(() => {
    processExited = true
  })
  for (let attempt = 0; attempt < UPSTREAM_READY_ATTEMPTS; attempt += 1) {
    if (processExited) {
      throw new UpstreamReadinessError()
    }
    if (await probeUpstreamHealth()) {
      return
    }
    await delay(UPSTREAM_READY_INTERVAL_MS)
  }
  throw new UpstreamReadinessError()
}

export function listenProductionProxy(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(
      MANAGED_WORKER_RUNTIME.PORT,
      "0.0.0.0",
      () => {
        server.off("error", reject)
        resolve()
      },
    )
  })
}

export function closeProductionProxy(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)))
  })
}
