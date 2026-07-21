import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { describe, expect, it } from "vitest"

const Scenario = {
  ABORT: "ABORT",
  NON_101: "NON_101",
  TCP_RESET: "TCP_RESET",
  TIMEOUT: "TIMEOUT",
} as const
const PROCESS_TEST_TIMEOUT_MS = 10_000

const ProbeResultSchema = z.object({
  completed: z.boolean(),
  ingressReleases: z.number().int().nonnegative(),
  reservationActive: z.number().int().nonnegative(),
  reservationBytes: z.number().int().nonnegative(),
  statusCode: z.number().int().nonnegative(),
  uncaught: z.number().int().nonnegative(),
}).strict().readonly()

async function runProbe(scenario: (typeof Scenario)[keyof typeof Scenario]) {
  const fixture = fileURLToPath(new URL("./fixtures/websocket-handshake-child.ts", import.meta.url))
  const child = spawn(process.execPath, ["--import", "tsx", fixture, scenario], {
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    stdio: ["ignore", "pipe", "pipe"],
  })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve))
  const output = Buffer.concat(stdout).toString("utf8").trim().split("\n").at(-1)
  if (output === undefined) throw new TypeError(Buffer.concat(stderr).toString("utf8"))
  return { exitCode, result: ProbeResultSchema.parse(JSON.parse(output)) }
}

describe("ManagedWebSocketGateway handshake process safety", () => {
  it.each([
    Scenario.NON_101,
    Scenario.TCP_RESET,
    Scenario.ABORT,
    Scenario.TIMEOUT,
  ])("owns terminal events and releases both reservations once for %s", async (scenario) => {
    // Given / When
    const probe = await runProbe(scenario)

    // Then
    expect(probe.exitCode).toBe(0)
    expect(probe.result).toEqual({
      completed: true,
      ingressReleases: 1,
      reservationActive: 0,
      reservationBytes: 0,
      statusCode: 502,
      uncaught: 0,
    })
  }, PROCESS_TEST_TIMEOUT_MS)
})
