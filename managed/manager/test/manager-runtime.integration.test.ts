import { connect } from "node:net"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { AddressInfo } from "node:net"
import {
  PRINCIPAL_KIND,
  PRINCIPAL_ROLE,
  PrincipalIdSchema,
} from "@happycastle/steel-managed-shared"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { parseManagerConfig } from "../src/config.js"
import {
  AuthenticationError,
  AuthenticationFailure,
} from "../src/auth/authentication-error.js"
import { createHealthServer } from "../src/health/health-server.js"
import { RuntimeHealth } from "../src/health/runtime-health.js"
import { AuthorizedRequestContextStore } from "../src/http/request-context-store.js"
import { RequestSecurity } from "../src/http/request-security.js"
import {
  AtomicReservationLedger,
  ReservationLedgerKind,
} from "../src/memory/atomic-reservation-ledger.js"
import {
  assertManagerRuntimePorts,
  ManagerRuntime,
  type ManagerRuntimePorts,
} from "../src/runtime/manager-runtime.js"
import { writeUiAssetManifest } from "../src/ui/asset-manifest.js"
import { validManagerConfigInput, validPoolId } from "./fixtures.js"

describe("manager runtime composition", () => {
  let runtime: ManagerRuntime | undefined
  let uiRoot: string

  beforeEach(async () => {
    uiRoot = await mkdtemp(path.join(tmpdir(), "steel-manager-runtime-ui-"))
    await writeFile(path.join(uiRoot, "index.html"), "<!doctype html><main>Steel</main>")
  })

  afterEach(async () => {
    await runtime?.close()
    await rm(uiRoot, { force: true, recursive: true })
  })

  it("fails closed before listener construction when a required port is absent", () => {
    expect(() => assertManagerRuntimePorts({})).toThrow("required manager runtime port missing")
  })

  it("starts both listeners, authenticates upgrades, becomes ready, and drains in order", async () => {
    const config = parseManagerConfig(validManagerConfigInput(), validPoolId())
    const health = new RuntimeHealth()
    const healthServer = createHealthServer({ health, host: "127.0.0.1", port: 0 })
    const contexts = new AuthorizedRequestContextStore()
    const events: string[] = []
    let upgradeCalls = 0
    const requestSecurity = new RequestSecurity({
      authenticate: async (headers) => {
        if (headers["cf-access-jwt-assertion"] !== "valid") {
          throw new AuthenticationError(AuthenticationFailure.MISSING_TOKEN)
        }
        return {
          id: PrincipalIdSchema.parse("USER:runtime-user"),
          kind: PRINCIPAL_KIND.USER,
          role: PRINCIPAL_ROLE.USER,
        }
      },
      originByHost: config.controlPlane.publicOriginByHost,
    })
    const ports: ManagerRuntimePorts = {
      closeDependencies: async () => {
        events.push("dependencies")
      },
      drain: async () => {
        events.push("drain")
      },
      reconciliation: {
        runNow: async () => {
          events.push("reconcile")
          health.recordReconciliation(true)
        },
        start: () => {
          events.push("start-loop")
        },
        stop: async () => {
          events.push("stop-loop")
        },
      },
      registerRoutes: (app) => {
        app.get("/v1/runtime-proof", async (request) => ({
          principalId: contexts.require(request.raw).principal.id,
        }))
      },
      webSocket: {
        close: async () => {
          events.push("websocket")
        },
        handle: async ({ connectionReservation, socket }) => {
          upgradeCalls += 1
          connectionReservation.release()
          socket.end("HTTP/1.1 101 Switching Protocols\r\nConnection: close\r\n\r\n")
        },
      },
    }
    const manifest = await writeUiAssetManifest(uiRoot)
    runtime = new ManagerRuntime({
      config,
      health,
      healthServer,
      ports,
      publicHost: "127.0.0.1",
      publicPort: 0,
      publicServer: {
        bodyLedger: ledger(
          ReservationLedgerKind.INGRESS_BODY,
          config.controlPlane.memory.ingressBodyBudgetBytes,
          config.controlPlane.memory.ingressBodyMax,
        ),
        compatibilityHealth: { read: async () => ({ status: "ok" }) },
        config,
        connectionLedger: ledger(
          ReservationLedgerKind.INGRESS_CONNECTION,
          config.controlPlane.memory.ingressConnectionBudgetBytes,
          config.controlPlane.memory.ingressConnectionMax,
        ),
        onConnectionRejected: () => undefined,
        requestContexts: contexts,
        requestSecurity,
        uiAssets: { manifest, root: uiRoot },
      },
      shutdownTimeoutMilliseconds: 1_000,
    })
    await runtime.start()

    const publicPort = listenerPort(runtime.publicServer().server.address())
    const healthPort = listenerPort(healthServer.server.address())
    const response = await runtime.publicServer().inject({
      headers: { "cf-access-jwt-assertion": "valid", host: "steel.example.com" },
      method: "GET",
      url: "/v1/runtime-proof",
    })
    expect(response.json()).toEqual({ principalId: "USER:runtime-user" })
    expect(await rawRequest(healthPort, "GET /readyz HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")).toContain("200 OK")
    expect(await rawRequest(publicPort, upgradeRequest())).toContain("401 Rejected")
    expect(upgradeCalls).toBe(0)
    expect(await rawRequest(publicPort, upgradeRequest("valid"))).toContain("101 Switching Protocols")
    expect(upgradeCalls).toBe(1)

    await runtime.close()
    expect(events.slice(0, 2)).toEqual(["reconcile", "start-loop"])
    expect(events.indexOf("drain")).toBeLessThan(events.indexOf("stop-loop"))
    expect(events.indexOf("stop-loop")).toBeLessThan(events.indexOf("websocket"))
    expect(health.snapshot().ready).toBe(false)
  })
})

function ledger(
  kind: ReservationLedgerKind,
  limitBytes: number,
  limitCount: number,
): AtomicReservationLedger {
  return new AtomicReservationLedger({ kind, limitBytes, limitCount })
}

function listenerPort(address: string | AddressInfo | null): number {
  if (address === null || typeof address === "string") throw new TypeError("TCP listener missing")
  return address.port
}

function upgradeRequest(token?: string): string {
  return [
    "GET /v1/sessions/example/live HTTP/1.1",
    "Host: steel.example.com",
    "Connection: Upgrade",
    "Upgrade: websocket",
    ...(token === undefined ? [] : [`Cf-Access-Jwt-Assertion: ${token}`]),
    "",
    "",
  ].join("\r\n")
}

async function rawRequest(port: number, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const socket = connect({ host: "127.0.0.1", port }, () => socket.write(request))
    socket.on("data", (chunk: Buffer) => chunks.push(chunk))
    socket.on("error", reject)
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
  })
}
