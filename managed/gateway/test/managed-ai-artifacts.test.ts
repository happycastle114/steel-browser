import { readFile } from "node:fs/promises"

import {
  AI_ROUTE_REGISTRY,
  HTTP_RESPONSE_HEADER,
} from "@happycastle/steel-managed-shared"
import { describe, expect, it } from "vitest"

import { renderGeneratedAiClientContract } from "../src/api/managed/client-generation.js"
import { createAiOpenApiDocument } from "../src/api/managed/openapi-generation.js"

describe("generated managed AI integration artifacts", () => {
  it("keeps the browser client route source byte-for-byte generated", async () => {
    const generatedPath = new URL("../../ai-client/src/generated-contract.ts", import.meta.url)

    expect(await readFile(generatedPath, "utf8")).toBe(renderGeneratedAiClientContract())
  })

  it("derives every OpenAPI path and method from the shared route registry", () => {
    const document = createAiOpenApiDocument()
    const actual = Object.entries(document.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => ({ method: method.toUpperCase(), path: path.replace("{id}", ":id") })))
    const expected = AI_ROUTE_REGISTRY.map((route) => ({ method: route.method, path: route.path }))

    expect(actual).toEqual(expected)
  })

  it("documents exact accepted and pending headers without a browser MCP client", () => {
    const document = createAiOpenApiDocument()
    const action = document.paths["/v1/actions"]?.["post"]
    const result = document.paths["/v1/results/{id}"]?.["get"]

    expect(action).toMatchObject({ responses: {
      202: { headers: {
        [HTTP_RESPONSE_HEADER.LOCATION]: { required: true },
        [HTTP_RESPONSE_HEADER.RETRY_AFTER]: { required: true },
      } },
    } })
    expect(result).toMatchObject({ responses: {
      200: { content: { "application/json": {}, "image/png": {}, "image/jpeg": {} } },
      202: { headers: { [HTTP_RESPONSE_HEADER.RETRY_AFTER]: { required: true } } },
    } })
    expect(Object.keys(document.paths)).not.toContain("/mcp")
  })
})
