import { createHash } from "node:crypto"

import { describe, expect, it } from "vitest"

import { canonicalJson } from "../src/canonical-json.js"
import {
  CONTROL_PLANE_API_VERSION,
  MCP_PROTOCOL_VERSION,
} from "../src/control-plane-contract.js"
import { RESULT_KIND, SESSION_STATE, TOOL_MUTABILITY, TOOL_SESSION_REQUIREMENT } from "../src/control-plane-vocabulary.js"
import {
  AI_ACTION_REQUEST_SCHEMA,
  TOOL_NAME,
  TOOL_NAMES,
  TOOL_VERSION,
} from "../src/tool-registry.js"
import {
  createToolContractCatalog,
} from "../src/tool-capabilities.js"
import { ToolDescriptorSchema } from "../src/tool-capability-schemas.js"
import { selectPublicOrigin } from "../src/public-urls.js"

const sessionId = "318f56c8-6f7a-4c45-9e5d-77adff18f7ac"

function collectContainers(value: unknown): object[] {
  if (value === null || typeof value !== "object") return []
  return [value, ...Object.values(value).flatMap(collectContainers)]
}

const EXPECTED_TOOL_NAMES = [
  "steel.session.create",
  "steel.session.list",
  "steel.session.get",
  "steel.session.release",
  "steel.admission.status",
  "steel.admission.cancel",
  "steel.browser.navigate",
  "steel.browser.snapshot",
  "steel.browser.screenshot",
  "steel.browser.scrape",
  "steel.browser.click",
  "steel.browser.type",
  "steel.browser.key",
  "steel.browser.live_view",
] as const

describe("canonical fourteen-tool registry", () => {
  const repeatedDescriptor = {
    name: EXPECTED_TOOL_NAMES[0],
    version: TOOL_VERSION,
    mutability: TOOL_MUTABILITY.WRITE,
    sessionRequirement: TOOL_SESSION_REQUIREMENT.NONE,
    inputSchemaSha256: "a".repeat(64),
    outputSchemaSha256: "b".repeat(64),
  }
  const capabilityLimits = {
    httpHeaderBytes: 1,
    httpBodyBytes: 1,
    httpConnectionCount: 1,
    httpConnectionReservedBytes: 1,
    httpBodyCount: 1,
    httpBodyReservedBytes: 1,
    textBytes: 1,
    binaryBytes: 1,
    resultBytes: 1,
    resultCount: 1,
    actionTimeoutMs: 1,
    actionCount: 1,
    webSocketCount: 1,
    webSocketReservedBytes: 1,
  }
  const selectedOrigin = selectPublicOrigin("steel.soungmin.kr", {
    "steel.soungmin.kr": "https://steel.soungmin.kr",
  })
  const catalog = createToolContractCatalog({ selectedOrigin, limits: capabilityLimits })
  const TOOL_DEFINITION_REGISTRY = catalog.definitionRegistry
  const TOOL_DESCRIPTORS = catalog.descriptors
  const TOOL_SCHEMA_DESCRIPTORS = catalog.schemaDescriptors
  const CapabilitiesSchema = catalog.capabilitiesSchema
  const ToolsResponseSchema = catalog.toolsResponseSchema
  const TextResultSchema = TOOL_DEFINITION_REGISTRY["steel.browser.scrape"].outputSchema

  it("advertises the latest stable MCP protocol revision", () => {
    // Given: the stable MCP transport revision frozen by the architecture.
    // When: capability metadata reads the centralized protocol version.
    // Then: it advertises the official 2025-11-25 revision exactly.
    expect(MCP_PROTOCOL_VERSION).toBe("2025-11-25")
  })

  it("contains exactly the approved names and versions", () => {
    // Given: the exported canonical registry.
    // When: names are read in stable declaration order.
    const names = [...TOOL_NAMES]
    // Then: no unapproved or missing tool exists.
    expect(names).toEqual(EXPECTED_TOOL_NAMES)
    expect(Object.values(TOOL_NAME)).toEqual(EXPECTED_TOOL_NAMES)
    expect(Object.keys(TOOL_DEFINITION_REGISTRY)).toEqual(EXPECTED_TOOL_NAMES)
    expect(Object.values(TOOL_DEFINITION_REGISTRY).every((tool) => tool.version === TOOL_VERSION)).toBe(true)
  })

  it.each(EXPECTED_TOOL_NAMES)("rejects additive input properties for %s", (name) => {
    // Given: a tool definition and one unknown argument.
    const definition = TOOL_DEFINITION_REGISTRY[name]
    // When: its input schema parses an additive-only object.
    const result = definition.inputSchema.safeParse({ undeclared: true })
    // Then: additionalProperties false is enforced.
    expect(result.success).toBe(false)
  })

  it("marks create as write without implicit session selection", () => {
    // Given: the session-create tool definition.
    // When: policy metadata is read.
    const definition = TOOL_DEFINITION_REGISTRY["steel.session.create"]
    // Then: it is a write with no pre-existing session requirement.
    expect(definition).toMatchObject({
      mutability: TOOL_MUTABILITY.WRITE,
      sessionRequirement: TOOL_SESSION_REQUIREMENT.NONE,
    })
  })

  it("marks every existing-session browser tool explicit", () => {
    // Given: all browser tools other than create/list admission operations.
    const names = EXPECTED_TOOL_NAMES.filter((name) => name.startsWith("steel.browser."))
    // When: session policies are inspected.
    const requirements = names.map((name) => TOOL_DEFINITION_REGISTRY[name].sessionRequirement)
    // Then: no adapter may infer an active session.
    expect(requirements.every((requirement) => requirement === TOOL_SESSION_REQUIREMENT.EXPLICIT)).toBe(true)
  })

  it("parses the exact create action envelope", () => {
    // Given: a canonical principal-scoped create action.
    const input = {
      apiVersion: CONTROL_PLANE_API_VERSION,
      tool: { name: "steel.session.create", version: TOOL_VERSION },
      arguments: { idempotencyKey: "request:12345678" },
    }
    // When: the generated discriminated action schema parses it.
    const result = AI_ACTION_REQUEST_SCHEMA.safeParse(input)
    // Then: the action is accepted.
    expect(result.success).toBe(true)
  })

  it.each([
    { tool: "steel.session.create", arguments: { idempotencyKey: "short" } },
    { tool: "steel.session.list", arguments: { state: [SESSION_STATE.LIVE], pageSize: 101 } },
    { tool: "steel.browser.navigate", arguments: { sessionId, url: "ftp://example.com" } },
    { tool: "steel.browser.key", arguments: { sessionId, key: "F13" } },
    { tool: "steel.browser.click", arguments: { sessionId, selector: "" } },
  ])("rejects invalid generated action arguments %#", ({ tool, arguments: toolArguments }) => {
    // Given: an exact tool name with invalid declared arguments.
    const input = { apiVersion: CONTROL_PLANE_API_VERSION, tool: { name: tool, version: TOOL_VERSION }, arguments: toolArguments }
    // When: the generated action union parses it.
    const result = AI_ACTION_REQUEST_SCHEMA.safeParse(input)
    // Then: the boundary fails before execution.
    expect(result.success).toBe(false)
  })

  it("rejects duplicated capability tools", () => {
    // Given: fourteen descriptors that repeat one valid registry name and version.
    const input = {
      apiVersion: CONTROL_PLANE_API_VERSION,
      service: { name: "happycastle-steel-managed", version: TOOL_VERSION },
      mcp: { endpoint: "/mcp", protocolVersion: MCP_PROTOCOL_VERSION, stateless: true },
      tools: Array.from({ length: EXPECTED_TOOL_NAMES.length }, () => repeatedDescriptor),
      limits: capabilityLimits,
    }
    // When: the capabilities boundary parses it.
    // Then: registry membership, uniqueness, and order are enforced.
    expect(CapabilitiesSchema.safeParse(input).success).toBe(false)
  })

  it("rejects a non-registry tool version", () => {
    // Given: one descriptor whose tool version drifts from the registry.
    const result = ToolDescriptorSchema.safeParse({ ...repeatedDescriptor, version: "2.0.0" })
    // When: the descriptor boundary parses it.
    // Then: exact registry version is enforced.
    expect(result.success).toBe(false)
  })

  it("rejects tool schemas and digests not generated by the canonical registry", () => {
    // Given: correctly ordered tool names carrying invented schemas and digests.
    const input = {
      apiVersion: CONTROL_PLANE_API_VERSION,
      service: { name: "happycastle-steel-managed", version: TOOL_VERSION },
      mcp: { endpoint: "/mcp", protocolVersion: MCP_PROTOCOL_VERSION, stateless: true },
      tools: EXPECTED_TOOL_NAMES.map((name) => ({
        ...repeatedDescriptor,
        name,
        inputSchema: { type: "null" },
        outputSchema: { type: "null" },
      })),
      limits: capabilityLimits,
    }
    // When: the public tools response crosses the generated registry boundary.
    const result = ToolsResponseSchema.safeParse(input)
    // Then: names alone cannot authorize invented schemas or SHA-256 values.
    expect(result.success).toBe(false)
  })

  it("publishes deterministic dereferenced schemas and canonical digests", () => {
    // Given: schemas generated directly from all canonical Zod tool definitions.
    // When: each JSON schema is canonicalized and independently hashed.
    const observed = TOOL_SCHEMA_DESCRIPTORS.flatMap((tool) => [
      createHash("sha256").update(canonicalJson(tool.inputSchema)).digest("hex") === tool.inputSchemaSha256,
      createHash("sha256").update(canonicalJson(tool.outputSchema)).digest("hex") === tool.outputSchemaSha256,
      !canonicalJson(tool.inputSchema).includes("\"$ref\""),
      !canonicalJson(tool.outputSchema).includes("\"$ref\""),
    ])
    // Then: every schema is reference-free and every digest matches its canonical bytes.
    expect(observed.every(Boolean)).toBe(true)
    expect(TOOL_SCHEMA_DESCRIPTORS.every((tool) =>
      typeof tool.inputSchema === "object" && tool.inputSchema !== null && !Array.isArray(tool.inputSchema) && tool.inputSchema.type === "object" &&
      typeof tool.outputSchema === "object" && tool.outputSchema !== null && !Array.isArray(tool.outputSchema) && tool.outputSchema.type === "object",
    )).toBe(true)
  })

  it("deep-freezes generated registry schemas", () => {
    // Given: every generated canonical tool descriptor.
    // When: all descriptor and recursively nested JSON-schema containers are inspected.
    const containers = collectContainers(TOOL_SCHEMA_DESCRIPTORS)
    // Then: every nested object and array is frozen and rejects representative mutation.
    expect(containers.every(Object.isFrozen)).toBe(true)
    expect(containers.every((container) => Reflect.set(container, "__mutation__", true) === false)).toBe(true)
  })

  it("accepts only generated capability and tools responses", () => {
    // Given: capability envelopes using the two canonical generated projections.
    const base = {
      apiVersion: CONTROL_PLANE_API_VERSION,
      service: { name: "happycastle-steel-managed", version: TOOL_VERSION },
      mcp: { endpoint: "/mcp", protocolVersion: MCP_PROTOCOL_VERSION, stateless: true },
      limits: capabilityLimits,
    }
    // When: the metadata-only and schema-bearing responses cross their boundaries.
    const results = [
      CapabilitiesSchema.safeParse({ ...base, tools: TOOL_DESCRIPTORS }).success,
      ToolsResponseSchema.safeParse({ ...base, tools: TOOL_SCHEMA_DESCRIPTORS }).success,
    ]
    // Then: both generated projections are accepted exactly.
    expect(results).toEqual([true, true])
  })

  it("binds screenshot output to retained binary metadata", () => {
    // Given: the generated screenshot and snapshot descriptors.
    const screenshot = TOOL_SCHEMA_DESCRIPTORS.find((tool) => tool.name === "steel.browser.screenshot")
    const snapshot = TOOL_SCHEMA_DESCRIPTORS.find((tool) => tool.name === "steel.browser.snapshot")
    if (screenshot === undefined || snapshot === undefined) throw new Error("canonical tool missing")
    // When: screenshot output is inspected and then replaced with snapshot output plus its valid digest.
    const mutated = TOOL_SCHEMA_DESCRIPTORS.map((tool) => tool.name === screenshot.name
      ? { ...tool, outputSchema: snapshot.outputSchema, outputSchemaSha256: snapshot.outputSchemaSha256 }
      : tool)
    const base = {
      apiVersion: CONTROL_PLANE_API_VERSION,
      service: { name: "happycastle-steel-managed", version: TOOL_VERSION },
      mcp: { endpoint: "/mcp", protocolVersion: MCP_PROTOCOL_VERSION, stateless: true },
      limits: capabilityLimits,
    }
    // Then: BinaryResult remains explicit and the coherent-looking mutation fails canonical linkage.
    expect(screenshot.outputSchema).toMatchObject({ properties: { kind: { const: RESULT_KIND.BINARY } } })
    expect(ToolsResponseSchema.safeParse({ ...base, tools: mutated }).success).toBe(false)
  })

  it("rejects inconsistent text truncation metadata", () => {
    // Given: a complete source falsely marked truncated without dropping bytes.
    const input = {
      kind: RESULT_KIND.TEXT,
      sessionId,
      format: "text",
      text: "hello",
      truncated: true,
      byteLength: 5,
      deliveredByteLength: 5,
      sha256: "a".repeat(64),
    }
    // When: the text result boundary parses it.
    // Then: truncation must strictly reduce delivered bytes.
    expect(TextResultSchema.safeParse(input).success).toBe(false)
  })
})
