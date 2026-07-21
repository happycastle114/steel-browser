import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it } from "vitest"
import {
  ACTIVE_SESSION_OBSERVATION_KIND,
  observeActiveSession,
} from "../src/active-session-observer.js"

function boundAddress(server: ReturnType<typeof createServer>): AddressInfo {
  const address = server.address()
  if (address === null || typeof address === "string") {
    throw new TypeError("expected an internet socket address")
  }
  return address
}

describe("bounded active session observer", () => {
  it("fails closed when upstream accepts but never sends a response", async () => {
    const upstream = createServer(() => undefined)
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve))
    const bound = boundAddress(upstream)
    const started = Date.now()

    const observation = await observeActiveSession({
      address: "127.0.0.1",
      port: bound.port,
      timeoutMs: 20,
    })

    expect(observation.kind).toBe(ACTIVE_SESSION_OBSERVATION_KIND.UNAVAILABLE)
    expect(Date.now() - started).toBeLessThan(500)
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
  })

  it("fails closed on an aborted partial response", async () => {
    const upstream = createServer((_incoming, response) => {
      response.writeHead(200, { "content-type": "application/json" })
      response.write('{"sessions":[')
      response.destroy()
    })
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve))
    const bound = boundAddress(upstream)

    const observation = await observeActiveSession({
      address: "127.0.0.1",
      port: bound.port,
      timeoutMs: 100,
    })

    expect(observation.kind).toBe(ACTIVE_SESSION_OBSERVATION_KIND.UNAVAILABLE)
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
  })

  it("does not classify a failed upstream session as reconciled idle", async () => {
    const upstream = createServer((_incoming, response) => {
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          sessions: [
            {
              id: "77c0575c-2513-4db5-a80e-8e2675041fcb",
              status: "failed",
            },
          ],
        }),
      )
    })
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve))
    const bound = boundAddress(upstream)

    const observation = await observeActiveSession({
      address: "127.0.0.1",
      port: bound.port,
      timeoutMs: 100,
    })

    expect(observation.kind).toBe(ACTIVE_SESSION_OBSERVATION_KIND.UNAVAILABLE)
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
  })

  it("uses the first current session and tolerates failed historical records", async () => {
    const upstream = createServer((_incoming, response) => {
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          sessions: [
            {
              id: "77c0575c-2513-4db5-a80e-8e2675041fcb",
              status: "idle",
            },
            {
              id: "11223344-5566-4788-99aa-bbccddeeff00",
              status: "failed",
            },
          ],
        }),
      )
    })
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve))
    const bound = boundAddress(upstream)

    const observation = await observeActiveSession({
      address: "127.0.0.1",
      port: bound.port,
      timeoutMs: 100,
    })

    expect(observation).toEqual({
      kind: ACTIVE_SESSION_OBSERVATION_KIND.AVAILABLE,
      session: null,
    })
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
  })
})
