import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"

import {
  COOLIFY_BROWSER_READBACK_CONTRACT,
  parseCoolifyBrowserReadbackReceipt,
} from "../src/coolify-browser-readback.js"
import { verifyCoolifyBrowserReadbackReceiptBytes } from "../src/coolify-browser-readback-verifier.js"
import { CREATE_JOURNAL_STATE, WORKER_STATE } from "../src/control-plane-vocabulary.js"

const IMAGE_DIGEST = `sha256:${"b".repeat(64)}`
const CANDIDATE_IMAGE = `ghcr.io/happycastle/worker@${IMAGE_DIGEST}`
const SESSION_ID = "77c0575c-2513-4db5-a80e-8e2675041fcb"
const CONFIG_DIGEST = `sha256:${"a".repeat(64)}`

function validReceipt() {
  return {
    schemaVersion: COOLIFY_BROWSER_READBACK_CONTRACT.SCHEMA_VERSION,
    image: {
      candidate: CANDIDATE_IMAGE,
      containerImageId: CONFIG_DIGEST,
      inspectedImageId: CONFIG_DIGEST,
      repoDigests: [CANDIDATE_IMAGE],
      containerId: "c".repeat(64),
      containerStartedAt: "2026-07-21T00:00:00.000Z",
    },
    identity: {
      workerId: "worker-00",
      instanceId: "218f56c8-6f7a-4c45-9e5d-77adff18f7ac",
    },
    source: {
      revision: "d".repeat(40),
      manifestSha256: "e".repeat(64),
      manifestVerified: true,
      manifestFileCount: 12,
    },
    security: {
      uid: 10_001,
      gid: 10_001,
      readOnlyRootFileSystem: true,
      noNewPrivileges: true,
      privileged: false,
      capabilities: [],
      browserProcessNoNewPrivileges: true,
      browserProcessSeccompMode: 2,
    },
    resources: {
      memoryCurrentBytes: 536_870_912,
      memoryLimitBytes: 2_684_354_560,
      memoryReservationBytes: 1_342_177_280,
      runMaxBytes: 67_108_864,
      tmpMaxBytes: 268_435_456,
      profileMaxBytes: 268_435_456,
      shmMaxBytes: 536_870_912,
    },
    network: {
      supervisorPort: 3_000,
      upstreamHost: "127.0.0.1",
      upstreamPort: 3_001,
      cdpTransport: "EPHEMERAL_LOOPBACK",
      exposedContainerPorts: [3_000],
      publishedHostPorts: [],
    },
    browser: {
      executable: "/usr/bin/chromium",
      versionCommand: "/usr/bin/chromium --version",
      versionOutput: "Chromium 150.0.7871.46 stable",
      version: "150.0.7871.46",
      arguments: ["--headless=new", "--remote-debugging-port=0"],
      dbusAddress: "unix:path=/run/steel/runtime/dbus-abc",
      headless: true,
      xvfbProcessCount: 0,
      sandboxEnabled: true,
      cdpCommand: "Browser.getVersion",
      cdpProduct: "Chrome/150.0.7871.46",
      cdpProtocolVersion: "1.3",
    },
    lifecycle: {
      created: { sessionId: SESSION_ID, journalState: CREATE_JOURNAL_STATE.LIVE, at: "2026-07-21T00:00:01.000Z" },
      cdpObserved: { sessionId: SESSION_ID, command: "Browser.getVersion", at: "2026-07-21T00:00:02.000Z" },
      released: { sessionId: SESSION_ID, journalState: CREATE_JOURNAL_STATE.RELEASED_TERMINAL, at: "2026-07-21T00:00:03.000Z" },
      idle: { workerId: "worker-00", instanceId: "218f56c8-6f7a-4c45-9e5d-77adff18f7ac", state: WORKER_STATE.IDLE, activeSessionId: null, at: "2026-07-21T00:00:04.000Z" },
    },
    route: {
      phase: "CANDIDATE_QUALIFICATION",
      host: "steel-candidate.soungmin.tech",
      publicOrigin: "https://steel-candidate.soungmin.tech",
      legacyProductionOwnerRunning: true,
    },
    evidence: {
      environment: "COOLIFY",
      status: "VERIFIED",
      capturedAt: "2026-07-21T00:00:05.000Z",
    },
  }
}

type ReceiptFixture = ReturnType<typeof validReceipt>
type Mutation = (receipt: ReceiptFixture) => unknown

const identityAndRuntimeMutations: readonly (readonly [string, Mutation])[] = [
  ["floating candidate", (r) => ({ ...r, image: { ...r.image, candidate: "worker:latest" } })],
  ["image ID mismatch", (r) => ({ ...r, image: { ...r.image, inspectedImageId: `sha256:${"f".repeat(64)}` } })],
  ["candidate absent", (r) => ({ ...r, image: { ...r.image, repoDigests: [`ghcr.io/other/worker@sha256:${"f".repeat(64)}`] } })],
  ["duplicate RepoDigests", (r) => ({ ...r, image: { ...r.image, repoDigests: [CANDIDATE_IMAGE, CANDIDATE_IMAGE] } })],
  ["container ID", (r) => ({ ...r, image: { ...r.image, containerId: "abc" } })],
  ["worker ID", (r) => ({ ...r, identity: { ...r.identity, workerId: "worker-99" } })],
  ["instance ID", (r) => ({ ...r, identity: { ...r.identity, instanceId: "not-a-uuid" } })],
  ["source revision", (r) => ({ ...r, source: { ...r.source, revision: "d".repeat(39) } })],
  ["manifest hash", (r) => ({ ...r, source: { ...r.source, manifestSha256: "e".repeat(63) } })],
  ["manifest sentinel", (r) => ({ ...r, source: { ...r.source, manifestVerified: false } })],
  ["manifest file count", (r) => ({ ...r, source: { ...r.source, manifestFileCount: 0 } })],
]

const securityAndResourceMutations: readonly (readonly [string, Mutation])[] = [
  ["uid", (r) => ({ ...r, security: { ...r.security, uid: 0 } })],
  ["gid", (r) => ({ ...r, security: { ...r.security, gid: 0 } })],
  ["mutable root", (r) => ({ ...r, security: { ...r.security, readOnlyRootFileSystem: false } })],
  ["new privileges", (r) => ({ ...r, security: { ...r.security, noNewPrivileges: false } })],
  ["privileged", (r) => ({ ...r, security: { ...r.security, privileged: true } })],
  ["capability", (r) => ({ ...r, security: { ...r.security, capabilities: ["SYS_ADMIN"] } })],
  ["browser privileges", (r) => ({ ...r, security: { ...r.security, browserProcessNoNewPrivileges: false } })],
  ["browser seccomp", (r) => ({ ...r, security: { ...r.security, browserProcessSeccompMode: 0 } })],
  ...(["memoryLimitBytes", "memoryReservationBytes", "runMaxBytes", "tmpMaxBytes", "profileMaxBytes", "shmMaxBytes"] as const).map((field) => [field, (r: ReceiptFixture) => ({ ...r, resources: { ...r.resources, [field]: r.resources[field] + 1 } })] as const),
  ["memory base exceeded", (r) => ({ ...r, resources: { ...r.resources, memoryCurrentBytes: 671_088_641 } })],
]

const browserAndNetworkMutations: readonly (readonly [string, Mutation])[] = [
  ["wrong executable", (r) => ({ ...r, browser: { ...r.browser, executable: "/usr/bin/google-chrome" } })],
  ["version output", (r) => ({ ...r, browser: { ...r.browser, versionOutput: "Chromium 150.0.7871.460" } })],
  ["CDP version", (r) => ({ ...r, browser: { ...r.browser, cdpProduct: "Chrome/150.0.7871.47" } })],
  ["CDP command", (r) => ({ ...r, browser: { ...r.browser, cdpCommand: "Page.getFrameTree" } })],
  ["CDP protocol", (r) => ({ ...r, browser: { ...r.browser, cdpProtocolVersion: "v1.3" } })],
  ["DBus", (r) => ({ ...r, browser: { ...r.browser, dbusAddress: "unix:path=/tmp/dbus" } })],
  ["headless mode", (r) => ({ ...r, browser: { ...r.browser, headless: false } })],
  ["sandbox", (r) => ({ ...r, browser: { ...r.browser, sandboxEnabled: false } })],
  ["Xvfb", (r) => ({ ...r, browser: { ...r.browser, xvfbProcessCount: 1 } })],
  ["sandbox flag", (r) => ({ ...r, browser: { ...r.browser, arguments: ["--headless=new", "--no-sandbox", "--remote-debugging-port=0"] } })],
  ["fixed CDP port", (r) => ({ ...r, browser: { ...r.browser, arguments: ["--headless=new", "--remote-debugging-port=9223"] } })],
  ["additive fixed CDP port", (r) => ({ ...r, browser: { ...r.browser, arguments: ["--headless=new", "--remote-debugging-port=0", "--remote-debugging-port=9223"] } })],
  ["public debugger", (r) => ({ ...r, network: { ...r.network, exposedContainerPorts: [3_000, 9_223] } })],
  ["published worker port", (r) => ({ ...r, network: { ...r.network, publishedHostPorts: [3_000] } })],
  ["supervisor drift", (r) => ({ ...r, network: { ...r.network, supervisorPort: 9_223 } })],
  ["upstream drift", (r) => ({ ...r, network: { ...r.network, upstreamPort: 9_223 } })],
  ["CDP transport", (r) => ({ ...r, network: { ...r.network, cdpTransport: "PUBLIC_TCP" } })],
]

const lifecycleAndRouteMutations: readonly (readonly [string, Mutation])[] = [
  ["CDP session", (r) => ({ ...r, lifecycle: { ...r.lifecycle, cdpObserved: { ...r.lifecycle.cdpObserved, sessionId: "abdf06a4-c779-4168-8edb-624294802166" } } })],
  ["CDP lifecycle command", (r) => ({ ...r, lifecycle: { ...r.lifecycle, cdpObserved: { ...r.lifecycle.cdpObserved, command: "Page.getFrameTree" } } })],
  ["release session", (r) => ({ ...r, lifecycle: { ...r.lifecycle, released: { ...r.lifecycle.released, sessionId: "abdf06a4-c779-4168-8edb-624294802166" } } })],
  ["journal terminal", (r) => ({ ...r, lifecycle: { ...r.lifecycle, released: { ...r.lifecycle.released, journalState: CREATE_JOURNAL_STATE.LIVE } } })],
  ["idle worker", (r) => ({ ...r, lifecycle: { ...r.lifecycle, idle: { ...r.lifecycle.idle, workerId: "worker-01" } } })],
  ["idle instance", (r) => ({ ...r, lifecycle: { ...r.lifecycle, idle: { ...r.lifecycle.idle, instanceId: "abdf06a4-c779-4168-8edb-624294802166" } } })],
  ["active after release", (r) => ({ ...r, lifecycle: { ...r.lifecycle, idle: { ...r.lifecycle.idle, activeSessionId: SESSION_ID } } })],
  ["event order", (r) => ({ ...r, lifecycle: { ...r.lifecycle, cdpObserved: { ...r.lifecycle.cdpObserved, at: "2026-07-21T00:00:00.500Z" } } })],
  ["offset event order", (r) => ({ ...r, lifecycle: { ...r.lifecycle, cdpObserved: { ...r.lifecycle.cdpObserved, at: "2026-07-21T09:00:00.500+09:00" } } })],
  ["container start order", (r) => ({ ...r, image: { ...r.image, containerStartedAt: "2026-07-21T00:00:01.500Z" } })],
  ["candidate host", (r) => ({ ...r, route: { ...r.route, host: "steel.soungmin.tech" } })],
  ["candidate origin", (r) => ({ ...r, route: { ...r.route, publicOrigin: "https://attacker.invalid" } })],
  ["candidate owner", (r) => ({ ...r, route: { ...r.route, legacyProductionOwnerRunning: false } })],
  ["canary phase", (r) => ({ ...r, route: { ...r.route, phase: "CANARY" } })],
  ["status", (r) => ({ ...r, evidence: { ...r.evidence, status: "PENDING" } })],
  ["environment", (r) => ({ ...r, evidence: { ...r.evidence, environment: "LOCAL" } })],
  ["time", (r) => ({ ...r, evidence: { ...r.evidence, capturedAt: "2026-07-21" } })],
  ["capture order", (r) => ({ ...r, evidence: { ...r.evidence, capturedAt: "2026-07-21T00:00:03.500Z" } })],
]

describe("canonical Coolify worker runtime readback receipt", () => {
  it("parses and deeply freezes candidate qualification proof", () => {
    // Given
    const receipt = validReceipt()

    // When
    const parsed = parseCoolifyBrowserReadbackReceipt(receipt)

    // Then
    expect(parsed.image.repoDigests).toContain(parsed.image.candidate)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.browser.arguments)).toBe(true)
  })

  it("accepts the real dbus-daemon address suffix", () => {
    const receipt = validReceipt()
    receipt.browser.dbusAddress = "unix:path=/run/steel/runtime/dbus-abc,guid=0123456789abcdef0123456789abcdef"

    expect(() => parseCoolifyBrowserReadbackReceipt(receipt)).not.toThrow()
  })

  it("accepts only the closed production reproof route binding", () => {
    const receipt = validReceipt()
    const production = { ...receipt, route: { phase: "PRODUCTION_REPROOF", host: "steel.soungmin.tech", publicOrigin: "https://steel.soungmin.tech", legacyProductionOwnerRunning: false } }

    const parsed = parseCoolifyBrowserReadbackReceipt(production)

    expect(parsed.route.host).toBe("steel.soungmin.tech")
  })

  it("enforces the exact static resource budget arithmetic", () => {
    const values = COOLIFY_BROWSER_READBACK_CONTRACT.RESOURCE
    const writable = values.RUN_MAX_BYTES + values.TMP_MAX_BYTES + values.PROFILE_MAX_BYTES + values.SHM_MAX_BYTES
    const maxBudget = Math.floor(values.MEMORY_LIMIT_BYTES * values.MAX_UTILIZATION_NUMERATOR / values.MAX_UTILIZATION_DENOMINATOR)

    expect(writable).toBe(values.WRITABLE_BYTES)
    expect(values.BASE_BYTES + writable).toBe(values.AGGREGATE_BYTES)
    expect(maxBudget - values.AGGREGATE_BYTES).toBe(values.SLACK_BYTES)
  })

  it.each([
    ["receipt hash", (raw: string, sha: string) => verifyCoolifyBrowserReadbackReceiptBytes(`${raw}\n`, { receiptSha256: sha, candidate: CANDIDATE_IMAGE, sourceRevision: "d".repeat(40) })],
    ["candidate", (raw: string, sha: string) => verifyCoolifyBrowserReadbackReceiptBytes(raw, { receiptSha256: sha, candidate: `ghcr.io/other/worker@sha256:${"f".repeat(64)}`, sourceRevision: "d".repeat(40) })],
    ["source revision", (raw: string, sha: string) => verifyCoolifyBrowserReadbackReceiptBytes(raw, { receiptSha256: sha, candidate: CANDIDATE_IMAGE, sourceRevision: "a".repeat(40) })],
  ])("rejects external %s mismatch before promotion", (_label, verify) => {
    const raw = JSON.stringify(validReceipt())
    const sha = createHash("sha256").update(raw).digest("hex")

    expect(() => verify(raw, sha)).toThrow()
  })

  it("verifies the exact external byte hash before parsing the receipt", () => {
    const raw = JSON.stringify(validReceipt())
    const receiptSha256 = createHash("sha256").update(raw).digest("hex")

    const parsed = verifyCoolifyBrowserReadbackReceiptBytes(raw, {
      receiptSha256,
      candidate: CANDIDATE_IMAGE,
      sourceRevision: "d".repeat(40),
    })

    expect(parsed.image.candidate).toBe(CANDIDATE_IMAGE)
  })

  it("rejects a self-referential receipt hash field", () => {
    const receipt = {
      ...validReceipt(),
      evidence: { ...validReceipt().evidence, receiptSha256: "f".repeat(64) },
    }

    expect(() => parseCoolifyBrowserReadbackReceipt(receipt)).toThrow()
  })

  it.each([...identityAndRuntimeMutations, ...securityAndResourceMutations, ...browserAndNetworkMutations, ...lifecycleAndRouteMutations])("rejects %s", (_label, mutate) => {
    // Given
    const receipt = mutate(validReceipt())

    // When
    const parse = () => parseCoolifyBrowserReadbackReceipt(receipt)

    // Then
    expect(parse).toThrow()
  })

  it("rejects unknown receipt fields", () => {
    const receipt = { ...validReceipt(), untrusted: true }

    const parse = () => parseCoolifyBrowserReadbackReceipt(receipt)

    expect(parse).toThrow()
  })
})
