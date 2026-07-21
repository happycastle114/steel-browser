import { type AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { createHealthServer, type HealthServer } from "../src/health/health-server.js"
import { RuntimeHealth } from "../src/health/runtime-health.js"
import { checkLiveness } from "../src/healthcheck-cli.js"

describe("loopback health server", () => {
  let active: HealthServer | undefined

  afterEach(async () => {
    await active?.close()
  })

  it("serves only liveness and readiness on the configured loopback address", async () => {
    // Given
    const health = new RuntimeHealth()
    active = createHealthServer({ health, host: "127.0.0.1", port: 0 })
    await active.listen()
    const address = listenerAddress(active)

    // When
    const live = await fetch(`http://127.0.0.1:${address.port}/livez`)
    const notReady = await fetch(`http://127.0.0.1:${address.port}/readyz`)
    const unknown = await fetch(`http://127.0.0.1:${address.port}/v1/health`)
    const wrongMethod = await fetch(`http://127.0.0.1:${address.port}/livez`, {
      method: "POST",
    })

    // Then
    expect(address.address).toBe("127.0.0.1")
    expect(live.status).toBe(200)
    expect(await live.text()).toBe("ok\n")
    expect(notReady.status).toBe(503)
    expect(unknown.status).toBe(404)
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers.get("allow")).toBe("GET")
    expect(await checkLiveness(address.port)).toBe(true)
  })

  it("keeps readiness independent of saturation and manager serving mode", async () => {
    // Given
    const health = new RuntimeHealth()
    health.markInitialized()
    health.recordReconciliation(true)
    active = createHealthServer({ health, host: "127.0.0.1", port: 0 })
    await active.listen()
    const address = listenerAddress(active)

    // When
    const ready = await fetch(`http://127.0.0.1:${address.port}/readyz`)

    // Then
    expect(ready.status).toBe(200)
    expect(await ready.text()).toBe("ready\n")
  })
})

function listenerAddress(server: HealthServer): AddressInfo {
  const address = server.server.address()
  if (address === null || typeof address === "string") {
    throw new TypeError("health server listener missing")
  }
  return address
}
