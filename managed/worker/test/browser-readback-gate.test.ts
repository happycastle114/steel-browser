import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  COOLIFY_BROWSER_READBACK_CONTRACT as CONTRACT,
  verifyCoolifyBrowserReadbackReceiptBytes,
} from "../src/browser-readback-gate.js"

const CANDIDATE = `ghcr.io/happycastle114/steel-managed-worker@sha256:${"a".repeat(64)}`
const SOURCE_REVISION = "b".repeat(40)
const SESSION_ID = "12345678-1234-4234-9234-123456789abc"
const INSTANCE_ID = "22345678-1234-4234-9234-123456789abc"

function receipt() {
  return {
    schemaVersion: CONTRACT.SCHEMA_VERSION,
    image: {
      candidate: CANDIDATE,
      containerImageId: `sha256:${"c".repeat(64)}`,
      inspectedImageId: `sha256:${"c".repeat(64)}`,
      repoDigests: [CANDIDATE],
      containerId: "1234567890abcdef",
      containerStartedAt: "2026-07-21T00:00:00.000Z",
    },
    identity: { workerId: "worker-00", instanceId: INSTANCE_ID },
    source: {
      revision: SOURCE_REVISION,
      manifestSha256: "d".repeat(64),
      manifestVerified: true,
      manifestFileCount: 1,
    },
    security: {
      uid: CONTRACT.UID,
      gid: CONTRACT.GID,
      readOnlyRootFileSystem: true,
      noNewPrivileges: true,
      privileged: false,
      capabilities: [],
      browserProcessNoNewPrivileges: true,
      browserProcessSeccompMode: CONTRACT.BROWSER_PROCESS_SECCOMP_MODE,
    },
    resources: {
      memoryCurrentBytes: 1,
      memoryLimitBytes: CONTRACT.RESOURCE.MEMORY_LIMIT_BYTES,
      memoryReservationBytes: CONTRACT.RESOURCE.MEMORY_RESERVATION_BYTES,
      runMaxBytes: CONTRACT.RESOURCE.RUN_MAX_BYTES,
      tmpMaxBytes: CONTRACT.RESOURCE.TMP_MAX_BYTES,
      profileMaxBytes: CONTRACT.RESOURCE.PROFILE_MAX_BYTES,
      shmMaxBytes: CONTRACT.RESOURCE.SHM_MAX_BYTES,
    },
    network: {
      supervisorPort: CONTRACT.NETWORK.SUPERVISOR_PORT,
      upstreamHost: CONTRACT.NETWORK.UPSTREAM_HOST,
      upstreamPort: CONTRACT.NETWORK.UPSTREAM_PORT,
      cdpTransport: CONTRACT.NETWORK.CDP_TRANSPORT,
      exposedContainerPorts: [CONTRACT.NETWORK.SUPERVISOR_PORT],
      publishedHostPorts: [],
    },
    browser: {
      executable: CONTRACT.BROWSER_EXECUTABLE,
      versionCommand: CONTRACT.VERSION_COMMAND,
      versionOutput: "Chromium 999.1.2.3",
      version: "999.1.2.3",
      arguments: [
        CONTRACT.BROWSER_ARGUMENT.HEADLESS,
        CONTRACT.BROWSER_ARGUMENT.DISABLE_SETUID_SANDBOX,
        CONTRACT.BROWSER_ARGUMENT.EPHEMERAL_CDP,
      ],
      dbusAddress: "unix:path=/run/steel/runtime/bus",
      headless: true,
      xvfbProcessCount: 0,
      sandboxEnabled: true,
      cdpCommand: CONTRACT.CDP_COMMAND,
      cdpProduct: "Chrome/999.1.2.3",
      cdpProtocolVersion: "1.3",
    },
    lifecycle: {
      created: { sessionId: SESSION_ID, journalState: "LIVE", at: "2026-07-21T00:00:01.000Z" },
      cdpObserved: { sessionId: SESSION_ID, command: CONTRACT.CDP_COMMAND, at: "2026-07-21T00:00:02.000Z" },
      released: { sessionId: SESSION_ID, journalState: "RELEASED_TERMINAL", at: "2026-07-21T00:00:03.000Z" },
      idle: { workerId: "worker-00", instanceId: INSTANCE_ID, state: "IDLE", activeSessionId: null, at: "2026-07-21T00:00:04.000Z" },
    },
    route: {
      phase: CONTRACT.ROUTE.CANDIDATE.PHASE,
      host: CONTRACT.ROUTE.CANDIDATE.HOST,
      publicOrigin: CONTRACT.ROUTE.CANDIDATE.PUBLIC_ORIGIN,
      legacyProductionOwnerRunning: CONTRACT.ROUTE.CANDIDATE.LEGACY_PRODUCTION_OWNER_RUNNING,
    },
    evidence: { environment: CONTRACT.ENVIRONMENT, status: CONTRACT.STATUS, capturedAt: "2026-07-21T00:00:05.000Z" },
  }
}

function verify(input: unknown, candidate = CANDIDATE): unknown {
  const raw = JSON.stringify(input)
  return verifyCoolifyBrowserReadbackReceiptBytes(raw, {
    candidate,
    receiptSha256: createHash("sha256").update(raw).digest("hex"),
    sourceRevision: SOURCE_REVISION,
  })
}

describe("Coolify browser readback promotion gate", () => {
  it("accepts the comprehensive exact-candidate runtime receipt", () => {
    expect(verify(receipt())).toMatchObject({ browser: { version: "999.1.2.3" } })
  })

  it.each([
    ["missing proof", {}],
    ["floating candidate", { ...receipt(), image: { ...receipt().image, candidate: "worker:latest" } }],
    ["unsafe sandbox", { ...receipt(), browser: { ...receipt().browser, arguments: ["--headless=new", "--no-sandbox"] } }],
    ["public CDP", { ...receipt(), network: { ...receipt().network, exposedContainerPorts: [3000, 9223] } }],
  ])("rejects %s", (_name, input) => expect(() => verify(input)).toThrow())

  it("rejects mutated raw bytes and a different candidate", () => {
    const raw = JSON.stringify(receipt())
    const sha = createHash("sha256").update(raw).digest("hex")
    expect(() => verifyCoolifyBrowserReadbackReceiptBytes(`${raw}\n`, {
      candidate: CANDIDATE,
      receiptSha256: sha,
      sourceRevision: SOURCE_REVISION,
    })).toThrow()
    expect(() => verify(receipt(), `ghcr.io/example/other@sha256:${"e".repeat(64)}`)).toThrow()
  })
})
