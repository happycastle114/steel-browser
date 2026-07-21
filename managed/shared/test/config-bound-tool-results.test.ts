import { describe, expect, it } from "vitest"

import { canonicalJson } from "../src/canonical-json.js"
import { CONTROL_PLANE_FIXED, parseControlPlaneConfig } from "../src/control-plane-config.js"
import { ResultIdSchema, SessionIdSchema } from "../src/control-plane-primitives.js"
import { RESULT_KIND, SESSION_STATE } from "../src/control-plane-vocabulary.js"
import { ManagedTransportConfigSchema, deriveManagedTransportConfig } from "../src/managed-transport-config.js"
import { buildResultDownloadUrl, selectConfiguredPublicOrigin, selectPublicOrigin } from "../src/public-urls.js"
import { createRetainedBinaryResultSchema } from "../src/retained-result-schema.js"
import { createManagedToolContracts, createToolContractCatalog } from "../src/tool-capabilities.js"
import { createToolResultSchemas } from "../src/tool-result-schemas.js"
import { MANAGED_RESULT_LIMIT, MANAGED_RESULT_REJECTION_REASON, MANAGED_RESULT_VALIDATION, createManagedResultValidator } from "../src/tool-result-validator.js"

const sessionId = SessionIdSchema.parse("118f56c8-6f7a-4c45-9e5d-77adff18f7ac")
const resultId = ResultIdSchema.parse("318f56c8-6f7a-4c45-9e5d-77adff18f7ac")
const selectedOrigin = selectPublicOrigin("steel.soungmin.kr", {
  "steel.soungmin.kr": "https://steel.soungmin.kr",
  "steel-candidate.soungmin.kr": "https://steel-candidate.soungmin.kr",
})
const transport = ManagedTransportConfigSchema.parse({
  httpBodyBytes: 8,
  textBytes: 4,
  binaryBytes: 6,
  resultBytes: 8,
})
const schemas = createToolResultSchemas(selectedOrigin, transport)

function sessionResult(host: string) {
  return {
    kind: RESULT_KIND.SESSION,
    session: {
      sessionId,
      state: SESSION_STATE.LIVE,
      createdAt: "2026-07-20T00:00:00.000Z",
    },
    urls: {
      websocketUrl: `wss://${host}/v1/sessions/${sessionId}`,
      debugUrl: `https://${host}/v1/sessions/${sessionId}/debug`,
      viewerUrl: `https://${host}/ui/sessions/${sessionId}/live`,
    },
  }
}

function binaryResult(host: string, byteLength: number) {
  return {
    kind: RESULT_KIND.BINARY,
    sessionId,
    resultId,
    contentType: "image/png",
    byteLength,
    sha256: "a".repeat(64),
    expiresAt: "2026-07-20T00:01:00.000Z",
    downloadUrl: `https://${host}/v1/results/${resultId}`,
  }
}

describe("config-bound public output schemas", () => {
  it.each(["attacker.com", "steel-candidate.soungmin.kr"])(
    "rejects a SessionResult from an unselected slot %s",
    (host) => {
      // Given: mutually consistent session URLs under an unselected public Host.
      const input = sessionResult(host)
      // When: the selected production output boundary parses the result.
      const result = schemas.SessionResultSchema.safeParse(input)
      // Then: same-origin agreement cannot substitute for configured selection.
      expect(result.success).toBe(false)
    },
  )

  it.each(["attacker.com", "steel-candidate.soungmin.kr"])(
    "rejects a LiveViewResult from an unselected slot %s",
    (host) => {
      // Given: mutually consistent live-view URLs under an unselected public Host.
      const input = {
        kind: RESULT_KIND.LIVE_VIEW,
        sessionId,
        viewerUrl: `https://${host}/ui/sessions/${sessionId}/live`,
        castWebSocketUrl: `wss://${host}/v1/sessions/${sessionId}/cast`,
      }
      // When: the selected production output boundary parses the result.
      const result = schemas.LiveViewResultSchema.safeParse(input)
      // Then: the selected slot remains authoritative.
      expect(result.success).toBe(false)
    },
  )

  it.each(["attacker.com", "steel-candidate.soungmin.kr"])(
    "rejects a BinaryResult from an unselected slot %s",
    (host) => {
      // Given: a retained result URL with the correct ID under an unselected Host.
      const input = binaryResult(host, transport.binaryBytes)
      // When: the selected production output boundary parses the result.
      const result = schemas.BinaryResultSchema.safeParse(input)
      // Then: exact result identity cannot authorize another public Host.
      expect(result.success).toBe(false)
    },
  )

  it("rejects full text source bytes above the advertised HTTP body ceiling", () => {
    // Given: a truncated text result whose source metadata exceeds the configured source bound.
    const input = { kind: RESULT_KIND.TEXT, sessionId, format: "text", text: "test", truncated: true, byteLength: 9, deliveredByteLength: 4, sha256: "a".repeat(64) }
    // When: the config-bound text result parser validates it.
    const result = schemas.TextResultSchema.safeParse(input)
    // Then: source limit plus one is rejected before presentation.
    expect(result.success).toBe(false)
  })

  it("rejects delivered text bytes above the advertised text ceiling", () => {
    // Given: a truncated UTF-8 payload whose delivered bytes exceed the configured text bound.
    const input = { kind: RESULT_KIND.TEXT, sessionId, format: "text", text: "hello", truncated: true, byteLength: 6, deliveredByteLength: 5, sha256: "a".repeat(64) }
    // When: the config-bound text result parser validates it.
    const result = schemas.TextResultSchema.safeParse(input)
    // Then: delivered limit plus one is rejected.
    expect(result.success).toBe(false)
  })

  it("rejects binary bytes above the advertised binary ceiling", () => {
    // Given: valid retained metadata at the configured binary limit plus one.
    const input = binaryResult("steel.soungmin.kr", transport.binaryBytes + 1)
    // When: the config-bound binary result parser validates it.
    const result = schemas.BinaryResultSchema.safeParse(input)
    // Then: oversize bytes are rejected before a public response.
    expect(result.success).toBe(false)
  })

  it("rejects one result above the advertised retained-byte ceiling", () => {
    // Given: a result ceiling lower than the binary ceiling and metadata at limit plus one.
    const retainedTransport = ManagedTransportConfigSchema.parse({ ...transport, binaryBytes: 8, resultBytes: 6 })
    // When: the retained-bound binary parser validates the metadata.
    const result = createToolResultSchemas(selectedOrigin, retainedTransport).BinaryResultSchema.safeParse(
      binaryResult("steel.soungmin.kr", retainedTransport.resultBytes + 1),
    )
    // Then: the retained-byte ceiling independently fails closed.
    expect(result.success).toBe(false)
  })

  it("returns a typed rejection before retained identity allocation", () => {
    // Given: an untrusted binary completion above the configured byte ceiling.
    const input = { kind: RESULT_KIND.BINARY, sessionId, contentType: "image/png", byteLength: 7, sha256: "a".repeat(64) }
    // When: the canonical pre-retention validator parses it.
    const result = createManagedResultValidator(selectedOrigin, transport).validateBinaryCompletion(input)
    // Then: the typed rejection carries no result ID or public Location.
    expect(result).toMatchObject({
      status: MANAGED_RESULT_VALIDATION.REJECTED,
      reason: MANAGED_RESULT_REJECTION_REASON.LIMIT_EXCEEDED,
      limit: MANAGED_RESULT_LIMIT.BINARY_BYTES,
      maximumBytes: transport.binaryBytes,
      observedBytes: transport.binaryBytes + 1,
    })
  })

  it("returns a typed invalid-contract rejection for malformed worker output", () => {
    // Given: a within-limit binary completion with an invalid digest.
    const input = { kind: RESULT_KIND.BINARY, sessionId, contentType: "image/png", byteLength: 6, sha256: "invalid" }
    // When: the canonical pre-retention validator parses it.
    const result = createManagedResultValidator(selectedOrigin, transport).validateBinaryCompletion(input)
    // Then: malformed output is distinct from capacity rejection.
    expect(result).toMatchObject({
      status: MANAGED_RESULT_VALIDATION.REJECTED,
      reason: MANAGED_RESULT_REJECTION_REASON.INVALID_CONTRACT,
    })
  })

  it.each([
    {
      configured: transport,
      input: { kind: RESULT_KIND.TEXT, sessionId, format: "text", text: "test", truncated: true, byteLength: 9, deliveredByteLength: 4, sha256: "a".repeat(64) },
      limit: MANAGED_RESULT_LIMIT.TEXT_SOURCE_BYTES,
    },
    {
      configured: transport,
      input: { kind: RESULT_KIND.TEXT, sessionId, format: "text", text: "hello", truncated: true, byteLength: 6, deliveredByteLength: 5, sha256: "a".repeat(64) },
      limit: MANAGED_RESULT_LIMIT.TEXT_DELIVERED_BYTES,
    },
    {
      configured: transport,
      input: binaryResult("steel.soungmin.kr", 7),
      limit: MANAGED_RESULT_LIMIT.BINARY_BYTES,
    },
    {
      configured: ManagedTransportConfigSchema.parse({ ...transport, binaryBytes: 8, resultBytes: 6 }),
      input: binaryResult("steel.soungmin.kr", 7),
      limit: MANAGED_RESULT_LIMIT.RETAINED_BYTES,
    },
  ])("classifies every advertised byte ceiling before result publication %#", ({ configured, input, limit }) => {
    // Given: one otherwise structured result at its configured ceiling plus one.
    // When: the canonical config-bound validator parses it.
    const result = createManagedResultValidator(selectedOrigin, configured).validateToolResult(input)
    // Then: every ceiling has a closed typed LIMIT_EXCEEDED classification.
    expect(result).toMatchObject({
      status: MANAGED_RESULT_VALIDATION.REJECTED,
      reason: MANAGED_RESULT_REJECTION_REASON.LIMIT_EXCEEDED,
      limit,
    })
  })
})

describe("completion-bound retained result schema", () => {
  const completedAtMs = 1_750_000_000_000
  const resultTtlMs = 60_000
  const expiresAt = new Date(completedAtMs + resultTtlMs).toISOString()
  const retainedSchema = createRetainedBinaryResultSchema({
    selectedOrigin,
    transport,
    resultId,
    completedAtMs,
    resultTtlMs,
  })
  const valid = {
    ...binaryResult("steel.soungmin.kr", transport.binaryBytes),
    expiresAt,
    downloadUrl: buildResultDownloadUrl(selectedOrigin, resultId),
  }

  it("accepts only the service-issued result identity and completion-derived expiry", () => {
    // Given: retained metadata produced after the atomic commit.
    // When: the completion-bound schema parses the final public result.
    const result = retainedSchema.safeParse(valid)
    // Then: exact ID, expiry, selected Host, and byte ceiling all agree.
    expect(result.success).toBe(true)
  })

  it.each([
    { resultId: "418f56c8-6f7a-4c45-9e5d-77adff18f7ac" },
    { expiresAt: new Date(completedAtMs + resultTtlMs + 1).toISOString() },
    { downloadUrl: `https://attacker.com/v1/results/${resultId}` },
  ])("rejects retained identity, expiry, or selected-Host drift %#", (mutation) => {
    // Given: final metadata that diverges after a trusted completion.
    const input = { ...valid, ...mutation }
    // When: the completion-bound schema validates it.
    const result = retainedSchema.safeParse(input)
    // Then: no divergent retained Location may be emitted.
    expect(result.success).toBe(false)
  })
})

describe("config-bound tool schema catalog", () => {
  const limits = {
    httpHeaderBytes: 1,
    httpBodyBytes: transport.httpBodyBytes,
    httpConnectionCount: 1,
    httpConnectionReservedBytes: 1,
    httpBodyCount: 1,
    httpBodyReservedBytes: 1,
    textBytes: transport.textBytes,
    binaryBytes: transport.binaryBytes,
    resultBytes: transport.resultBytes,
    resultCount: 1,
    actionTimeoutMs: 1,
    actionCount: 1,
    webSocketCount: 1,
    webSocketReservedBytes: 1,
  }
  const catalog = createToolContractCatalog({ selectedOrigin, limits })

  it("embeds the selected Host and byte maxima in generated output schemas", () => {
    // Given: descriptors generated from the config-bound runtime schemas.
    const serialized = canonicalJson(catalog.schemaDescriptors)
    // When: the selected slot and configured maxima are inspected.
    const screenshot = catalog.schemaDescriptors.find((tool) => tool.name === "steel.browser.screenshot")
    // Then: generated contracts carry the same Host and binary ceiling used at runtime.
    expect(serialized).toContain("steel\\\\.soungmin\\\\.kr")
    expect(serialized).not.toContain("attacker.com")
    expect(screenshot?.outputSchema).toMatchObject({ properties: { byteLength: { maximum: transport.binaryBytes } } })
  })

  it("rejects capability limits that differ from the schema-generating configuration", () => {
    // Given: valid canonical descriptors paired with an advertised text limit plus one.
    const input = {
      apiVersion: "managed.steel.soungmin.kr/v1alpha1",
      service: { name: "happycastle-steel-managed", version: "1.0.0" },
      mcp: { endpoint: "/mcp", protocolVersion: "2025-11-25", stateless: true },
      tools: catalog.descriptors,
      limits: { ...catalog.limits, textBytes: catalog.limits.textBytes + 1 },
    }
    // When: the bound capability response validates it.
    const result = catalog.capabilitiesSchema.safeParse(input)
    // Then: advertised ceilings cannot drift from enforced ceilings.
    expect(result.success).toBe(false)
  })
})

describe("control-plane config projection", () => {
  const controlPlaneConfig = parseControlPlaneConfig({
    maxConcurrentManagedProjects: 1,
    activeManagerCount: 1,
    activeWorkerCount: 2,
    coldStandbyProjectCount: 1,
    managerBaseP95Bytes: 100_000_000,
    accessIssuer: "https://happycastle.cloudflareaccess.com",
    accessAudience: "steel-audience",
    allowedHosts: ["steel.soungmin.kr"],
    publicOriginByHost: { "steel.soungmin.kr": "https://steel.soungmin.kr" },
    operatorServicePrincipals: ["steel-operator"],
    poolId: "managed-blue",
  })

  it("derives selected origin and advertised limits from one parsed config", () => {
    // Given: a startup-validated control-plane configuration.
    const origin = selectConfiguredPublicOrigin("steel.soungmin.kr", controlPlaneConfig)
    // When: the canonical managed tool catalog is created.
    const catalog = createManagedToolContracts({ selectedOrigin: origin, controlPlaneConfig })
    // Then: no adapter duplicates the origin or capacity projection.
    expect(catalog.limits).toMatchObject({
      httpHeaderBytes: CONTROL_PLANE_FIXED.httpHeaderBytes,
      httpBodyBytes: controlPlaneConfig.httpBodyBytes,
      textBytes: controlPlaneConfig.aiTextBytes,
      binaryBytes: controlPlaneConfig.aiBinaryBytes,
      resultBytes: controlPlaneConfig.memory.resultBudgetBytes,
      resultCount: controlPlaneConfig.memory.resultCountLimit,
    })
    expect(deriveManagedTransportConfig(controlPlaneConfig)).toEqual({ httpBodyBytes: catalog.limits.httpBodyBytes, textBytes: catalog.limits.textBytes, binaryBytes: catalog.limits.binaryBytes, resultBytes: catalog.limits.resultBytes })
  })
})
