import {
  TOOL_MUTABILITY,
  TOOL_NAME,
  TOOL_NAMES,
  TOOL_SESSION_REQUIREMENT,
  type ToolName,
} from "@happycastle/steel-managed-shared/browser"

const apiVersion = "2026-07-01"
const now = "2026-07-21T04:00:00.000Z"
const liveSessionId = "550e8400-e29b-41d4-a716-446655440000"
const queuedSessionId = "550e8400-e29b-41d4-a716-446655440010"
const admissionId = "550e8400-e29b-41d4-a716-446655440020"
const instanceOne = "550e8400-e29b-41d4-a716-446655440001"
const instanceTwo = "550e8400-e29b-41d4-a716-446655440002"

const page = { hasMore: false, pageSize: 50, snapshotCursor: "s1" }
const memoryLedger = { limitBytes: 16_777_216, limitCount: 8, reservedBytes: 2_097_152, reservedCount: 1 }
const liveSession = { createdAt: now, instanceId: instanceOne, sessionId: liveSessionId, startedAt: now, state: "LIVE", workerId: "worker-00" }
const queuedSession = { admissionId, createdAt: now, sessionId: queuedSessionId, state: "QUEUED" }
const admission = { admissionId, createdAt: now, expiresAt: "2026-07-21T04:05:00.000Z", position: 1, state: "QUEUED", updatedAt: now }
const readTools = new Set<ToolName>([
  TOOL_NAME.SESSION_LIST,
  TOOL_NAME.SESSION_GET,
  TOOL_NAME.ADMISSION_STATUS,
  TOOL_NAME.BROWSER_SNAPSHOT,
  TOOL_NAME.BROWSER_SCREENSHOT,
  TOOL_NAME.BROWSER_SCRAPE,
  TOOL_NAME.BROWSER_LIVE_VIEW,
])
const sessionTools = new Set<ToolName>([
  TOOL_NAME.SESSION_GET,
  TOOL_NAME.SESSION_RELEASE,
  TOOL_NAME.BROWSER_NAVIGATE,
  TOOL_NAME.BROWSER_SNAPSHOT,
  TOOL_NAME.BROWSER_SCREENSHOT,
  TOOL_NAME.BROWSER_SCRAPE,
  TOOL_NAME.BROWSER_CLICK,
  TOOL_NAME.BROWSER_TYPE,
  TOOL_NAME.BROWSER_KEY,
  TOOL_NAME.BROWSER_LIVE_VIEW,
])
const toolDescriptor = (name: ToolName) => ({
  inputSchemaSha256: "a".repeat(64),
  mutability: readTools.has(name) ? TOOL_MUTABILITY.READ : TOOL_MUTABILITY.WRITE,
  name,
  outputSchemaSha256: "b".repeat(64),
  sessionRequirement: sessionTools.has(name) ? TOOL_SESSION_REQUIREMENT.EXPLICIT : TOOL_SESSION_REQUIREMENT.NONE,
  version: "1.0.0",
})
const tools = TOOL_NAMES.map(toolDescriptor)

export const fixtures = {
  admission,
  admissions: { apiVersion, items: [admission], page },
  capabilities: {
    apiVersion,
    limits: { actionCount: 2, actionTimeoutMs: 30_000, binaryBytes: 8_388_608, httpBodyBytes: 1_048_576, httpBodyCount: 16, httpBodyReservedBytes: 1_048_576, httpConnectionCount: 16, httpConnectionReservedBytes: 524_288, httpHeaderBytes: 16_384, resultBytes: 16_777_216, resultCount: 32, textBytes: 1_048_576, webSocketCount: 2, webSocketReservedBytes: 524_288 },
    mcp: { endpoint: "/mcp", protocolVersion: "2025-11-25", stateless: true },
    service: { name: "happycastle-steel-managed", version: "1.0.0" },
    tools,
  },
  events: {
    apiVersion,
    hasMore: false,
    items: [
      { apiVersion, bootId: instanceOne, eventId: `${instanceOne}:2`, occurredAt: now, payload: { from: "STARTING", to: "LIVE" }, sequence: "2", sessionId: liveSessionId, type: "SESSION_STATE_CHANGED" },
      { apiVersion, bootId: instanceOne, eventId: `${instanceOne}:1`, instanceId: instanceOne, occurredAt: now, payload: { from: "STARTING", to: "LIVE" }, sequence: "1", type: "WORKER_STATE_CHANGED", workerId: "worker-00" },
    ],
    nextCursor: "e2",
    snapshotCursor: "e2",
  },
  liveSession,
  navigationResult: { completedAt: now, kind: "navigation", sessionId: liveSessionId, title: "Example Domain", url: "https://example.com/" },
  pool: {
    apiVersion,
    counts: { busy: 1, byState: { discovered: 0, draining: 0, idle: 1, live: 1, quarantined: 0, reachable: 0, releasing: 0, reserved: 0, starting: 0, unreachable: 0 }, physical: 2, reconciledIdle: 1, unavailable: 0, usableReachable: 2 },
    generatedAt: now,
    handover: { blocking: { httpCreates: 0, live: 1, queued: 1, releasing: 0, reserved: 0, starting: 0, uncertain: 0, webSockets: 0 }, mode: "SERVING", safe: false },
    managerInstanceId: instanceTwo,
    memory: { action: memoryLedger, baseP95Bytes: 268_435_456, dynamicLimitBytes: 83_886_080, ingressBody: memoryLedger, ingressConnection: memoryLedger, managerLimitBytes: 1_073_741_824, result: memoryLedger, snapshotLimitBytes: 16_777_216, tmpfsLimitBytes: 268_435_456, webSocket: memoryLedger },
    mode: "SERVING",
    poolId: "steel-managed",
    queue: { depth: 1, max: 100, oldestWaitMs: 12_000 },
  },
  queuedSession,
  sessions: { apiVersion, items: [liveSession, queuedSession], page },
  tools: {
    apiVersion,
    limits: { actionCount: 2, actionTimeoutMs: 30_000, binaryBytes: 8_388_608, httpBodyBytes: 1_048_576, httpBodyCount: 16, httpBodyReservedBytes: 1_048_576, httpConnectionCount: 16, httpConnectionReservedBytes: 524_288, httpHeaderBytes: 16_384, resultBytes: 16_777_216, resultCount: 32, textBytes: 1_048_576, webSocketCount: 2, webSocketReservedBytes: 524_288 },
    mcp: { endpoint: "/mcp", protocolVersion: "2025-11-25", stateless: true },
    service: { name: "happycastle-steel-managed", version: "1.0.0" },
    tools: tools.map((tool) => ({ ...tool, inputSchema: { type: "object" }, outputSchema: { type: "object" } })),
  },
  version: { apiVersion, browserVersion: "125.0.6422.60", createTokenKeyId: "0123456789abcdef", managedSha: "c".repeat(40), managerConfigSha256: "2".repeat(64), managerDigest: `sha256:${"d".repeat(64)}`, releaseEvidenceMode: "CONFIG_FILE", releaseEvidenceSha256: "3".repeat(64), startedAt: now, toolchainLockSha256: "e".repeat(64), upstreamSha: "f".repeat(40), workerDigest: `sha256:${"1".repeat(64)}` },
  workers: { apiVersion, items: [{ instanceId: instanceOne, lastSeenAt: now, sessionId: liveSessionId, state: "LIVE", stateChangedAt: now, workerId: "worker-00" }, { instanceId: instanceTwo, lastSeenAt: now, state: "IDLE", stateChangedAt: now, workerId: "worker-01" }], page },
} as const

export { admissionId, liveSessionId }
