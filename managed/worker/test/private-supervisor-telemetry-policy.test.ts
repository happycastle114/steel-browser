import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { verifyPrivateSupervisorTelemetrySource } from "../src/private-supervisor-telemetry-policy.js"

const REPOSITORY_ROOT = resolve(import.meta.dirname, "../../..")
const PRIVATE_REQUEST_SOURCES = [
  "managed/worker/src/create-journal-contract.ts",
  "managed/worker/src/create-journal-http.ts",
  "managed/worker/src/create-journal-response.ts",
  "managed/worker/src/create-journal-store.ts",
  "managed/worker/src/create-upstream-transaction.ts",
  "managed/worker/src/supervisor-endpoints.ts",
  "managed/worker/src/supervisor-proxy.ts",
  "managed/worker/src/supervisor-transport.ts",
] as const

async function shippedPrivateRequestSource(): Promise<string> {
  return (await Promise.all(PRIVATE_REQUEST_SOURCES.map((path) =>
    readFile(resolve(REPOSITORY_ROOT, path), "utf8"),
  ))).join("\n")
}

describe("private supervisor telemetry policy", () => {
  it("keeps lookup tokens and route values out of log and telemetry sinks", async () => {
    const source = await shippedPrivateRequestSource()

    expect(() => verifyPrivateSupervisorTelemetrySource(source)).not.toThrow()
  })

  it.each([
    'console.info("lookup", encodedToken)',
    'telemetry.record("lookup", encodedToken)',
  ])("fails a mutation that emits the raw lookup token: %s", async (mutation) => {
    const mutated = `${await shippedPrivateRequestSource()}\n${mutation}`

    expect(() => verifyPrivateSupervisorTelemetrySource(mutated)).toThrow(
      "must not write request data to telemetry sinks",
    )
  })
})
