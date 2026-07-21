import { describe, expect, it } from "vitest"

import { CONTROL_PLANE_API_VERSION } from "../src/control-plane-contract.js"
import { selectPublicOrigin } from "../src/public-urls.js"
import { createToolContractCatalog } from "../src/tool-capabilities.js"
import { createAiToolPageContract } from "../src/ai-tool-page.js"
import {
  StructuralCapabilitiesSchema,
  StructuralToolsResponseSchema,
} from "../src/tool-capability-schemas.js"

const selectedOrigin = selectPublicOrigin("steel.soungmin.kr", {
  "steel.soungmin.kr": "https://steel.soungmin.kr",
})
const limits = {
  httpHeaderBytes: 1,
  httpBodyBytes: 8,
  httpConnectionCount: 1,
  httpConnectionReservedBytes: 1,
  httpBodyCount: 1,
  httpBodyReservedBytes: 1,
  textBytes: 4,
  binaryBytes: 6,
  resultBytes: 8,
  resultCount: 1,
  actionTimeoutMs: 1,
  actionCount: 1,
  webSocketCount: 1,
  webSocketReservedBytes: 1,
} as const
const catalog = createToolContractCatalog({
  selectedOrigin,
  limits,
})
const browserContract = await createAiToolPageContract({ selectedOrigin, limits })
const firstTool = catalog.schemaDescriptors[0]
if (firstTool === undefined) throw new TypeError("canonical tool descriptor missing")
const AiToolPageSchema = browserContract.schema
const validPage = {
  apiVersion: CONTROL_PLANE_API_VERSION,
  items: [firstTool],
  page: { pageSize: 1, nextCursor: "tools_MQ", hasMore: true },
}

describe("paginated AI tool discovery", () => {
  it("derives the exact server catalog from the browser-safe canonical authority", () => {
    // Given: one origin and transport-limit configuration shared with the server catalog.
    // When: the browser-safe contract generates the canonical schema descriptors.
    // Then: its descriptors, schemas, hashes, and order exactly match the Node catalog.
    expect(browserContract.schemaDescriptors).toEqual(catalog.schemaDescriptors)
  })

  it("accepts exact generated descriptor items with a bounded cursor page", () => {
    // Given: one generated descriptor and a consistent continuation page.
    // When: the browser-safe AI tools boundary parses it.
    const result = AiToolPageSchema.safeParse(validPage)
    // Then: the canonical page is accepted.
    expect(result.success).toBe(true)
  })

  it("deep-freezes the parsed tool page", () => {
    // Given: a valid mutable wire object.
    // When: the browser-safe tool page boundary parses it.
    const parsed = AiToolPageSchema.parse(validPage)
    // Then: the envelope, descriptor array, descriptor, and page are immutable.
    expect([
      parsed,
      parsed.items,
      parsed.items[0],
      parsed.page,
    ].every((value) => value !== undefined && Object.isFrozen(value))).toBe(true)
  })

  it.each([
    { ...validPage, page: { ...validPage.page, hasMore: false } },
    { ...validPage, page: { pageSize: 1, hasMore: true } },
    { ...validPage, page: { ...validPage.page, pageSize: 0 } },
    { ...validPage, page: { ...validPage.page, pageSize: 15 } },
    { ...validPage, page: { ...validPage.page, nextCursor: "x" } },
  ])("rejects cursor and page consistency drift %#", (input) => {
    // Given: a page with contradictory continuation state or a non-canonical cursor.
    // When: the AI tools boundary parses it.
    const result = AiToolPageSchema.safeParse(input)
    // Then: pagination fails closed.
    expect(result.success).toBe(false)
  })

  it("rejects more tool entries than the advertised page size", () => {
    // Given: two valid tool entries paired with an advertised page size of one.
    const input = { ...validPage, items: [firstTool, catalog.schemaDescriptors[1]], page: { pageSize: 1, hasMore: false } }
    // When: the live tools response boundary validates pagination.
    const result = AiToolPageSchema.safeParse(input)
    // Then: the item window cannot exceed its advertised capacity.
    expect(result.success).toBe(false)
  })

  it("rejects duplicate tool names within one page", () => {
    // Given: two individually valid descriptors for the same tool name.
    const input = { ...validPage, items: [firstTool, firstTool], page: { pageSize: 2, hasMore: false } }
    // When: the live tools response boundary validates pagination.
    const result = AiToolPageSchema.safeParse(input)
    // Then: a cursor page cannot repeat one canonical registry entry.
    expect(result.success).toBe(false)
  })

  it.each([
    { ...validPage, items: [{ ...firstTool, inputSchemaSha256: "0".repeat(64) }] },
    { ...validPage, items: [{ ...firstTool, inputSchema: null }] },
    { ...validPage, items: [catalog.schemaDescriptors[1], firstTool], page: { pageSize: 2, hasMore: true, nextCursor: "tools_Mg" } },
    { ...validPage, page: { pageSize: 1, hasMore: true, nextCursor: "tools_Mg" } },
  ])("rejects forged canonical descriptor and cursor bindings %#", (input) => {
    // Given: a page with forged digest/schema/order/cursor data.
    // When: the catalog-bound boundary parses it.
    const result = AiToolPageSchema.safeParse(input)
    // Then: the exact canonical window is required.
    expect(result.success).toBe(false)
  })

  it("accepts the terminal canonical window without a continuation cursor", () => {
    // Given: the final descriptor in canonical registry order.
    const lastTool = catalog.schemaDescriptors[catalog.schemaDescriptors.length - 1]
    if (lastTool === undefined) throw new TypeError("canonical terminal descriptor missing")
    // When: a terminal `/v1/tools` response is parsed.
    const result = AiToolPageSchema.safeParse({
      apiVersion: CONTROL_PLANE_API_VERSION,
      items: [lastTool],
      page: { pageSize: 1, hasMore: false },
    })
    // Then: the canonical terminal page is accepted.
    expect(result.success).toBe(true)
  })

  it.each([
    { ...validPage, additive: true },
    { ...validPage, items: [{ ...firstTool, additive: true }] },
    { ...validPage, page: { ...validPage.page, additive: true } },
  ])("rejects additive tool page fields %#", (input) => {
    // Given: an additive field at one tool-page boundary layer.
    // When: the strict page parser validates it.
    const result = AiToolPageSchema.safeParse(input)
    // Then: top-level, item, and page additions are rejected.
    expect(result.success).toBe(false)
  })
})

describe("immutable capability clients", () => {
  const base = {
    apiVersion: CONTROL_PLANE_API_VERSION,
    service: { name: "happycastle-steel-managed", version: "1.0.0" },
    mcp: { endpoint: "/mcp", protocolVersion: "2025-11-25", stateless: true },
    limits: catalog.limits,
  }

  it.each([
    [StructuralCapabilitiesSchema, catalog.descriptors],
    [StructuralToolsResponseSchema, catalog.schemaDescriptors],
  ])("deep-freezes parsed capability response %#", (schema, tools) => {
    // Given: one valid capability response variant.
    // When: the browser-safe structural boundary parses it.
    const parsed = schema.parse({ ...base, tools })
    // Then: the response, tools, and limits are recursively immutable.
    expect([
      parsed,
      parsed.tools,
      parsed.tools[0],
      parsed.limits,
    ].every((value) => value !== undefined && Object.isFrozen(value))).toBe(true)
  })
})
