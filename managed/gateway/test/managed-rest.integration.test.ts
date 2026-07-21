import {
  AI_ASYNC_OUTCOME_STATE,
  MANAGED_ERROR_CODE,
  PRINCIPAL_ROLE,
  TOOL_NAMES,
  createManagedToolContracts,
  selectConfiguredPublicOrigin,
} from "@happycastle/steel-managed-shared"
import type { FastifyInstance } from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import {
  NAVIGATE_ACTION,
  NAVIGATION_OUTPUT,
  OTHER_OWNER_ID,
  OWNER_ID,
  PUBLIC_HOST,
  PUBLIC_ORIGIN,
  RESULT_ID,
  SCREENSHOT_ACTION,
  SCREENSHOT_BYTES,
  SCREENSHOT_COMPLETION,
  TestExecutionPort,
  createTestServer,
  principal,
  testConfig,
} from "./managed-transport-test-support.js"

const openApps: FastifyInstance[] = []
const hostHeaders = { host: PUBLIC_HOST }

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()))
})

async function server(input: Parameters<typeof createTestServer>[0] = {}) {
  const created = await createTestServer(input)
  openApps.push(created.app)
  return created
}

async function submit(app: FastifyInstance, action = NAVIGATE_ACTION) {
  return app.inject({
    method: "POST",
    url: "/v1/actions",
    headers: { ...hostHeaders, "content-type": "application/json" },
    payload: action,
  })
}

describe("managed REST transport integration", () => {
  it("serves the dynamic immutable 14-tool catalog and paginates its schemas", async () => {
    const { app } = await server()
    const capabilities = await app.inject({ method: "GET", url: "/v1/capabilities", headers: hostHeaders })
    const first = await app.inject({ method: "GET", url: "/v1/tools?pageSize=5", headers: hostHeaders })
    const firstBody = first.json()
    const second = await app.inject({
      method: "GET",
      url: `/v1/tools?pageSize=5&cursor=${firstBody.page.nextCursor}`,
      headers: hostHeaders,
    })
    const config = testConfig()
    const expected = createManagedToolContracts({
      selectedOrigin: selectConfiguredPublicOrigin(PUBLIC_HOST, config),
      controlPlaneConfig: config,
    })

    expect(capabilities.statusCode).toBe(200)
    expect(capabilities.json().tools).toEqual(expected.descriptors)
    expect(capabilities.json().tools.map((tool: Readonly<{ name: string }>) => tool.name)).toEqual(TOOL_NAMES)
    expect(firstBody.items).toEqual(expected.schemaDescriptors.slice(0, 5))
    expect(second.json().items).toEqual(expected.schemaDescriptors.slice(5, 10))
  })

  it("commits before exposing an absolute accepted Location and retained JSON result", async () => {
    const { app, transport } = await server()
    const accepted = await submit(app)
    const completed = await app.inject({
      method: "GET",
      url: `/v1/results/${RESULT_ID}`,
      headers: { ...hostHeaders, accept: "application/json" },
    })

    expect(accepted.statusCode).toBe(202)
    expect(accepted.headers.location).toBe(`${PUBLIC_ORIGIN}/v1/results/${RESULT_ID}`)
    expect(accepted.json()).toMatchObject({ resultId: RESULT_ID, state: AI_ASYNC_OUTCOME_STATE.ACCEPTED })
    expect(completed.statusCode).toBe(200)
    expect(completed.json()).toMatchObject({
      resultId: RESULT_ID,
      state: AI_ASYNC_OUTCOME_STATE.COMPLETED,
      result: NAVIGATION_OUTPUT,
    })
    expect(transport.gauges().result).toMatchObject({ retainedCount: 1, inFlightCount: 0 })
  })

  it("returns pending before a detached action completes", async () => {
    let complete: (() => void) | undefined
    const port = new TestExecutionPort({
      execute: (invocation) => new Promise((resolve) => {
        complete = () => resolve({
          resultId: invocation.resultId,
          action: invocation.action,
          ownerId: OWNER_ID,
          completedAtMs: 2_000,
          output: NAVIGATION_OUTPUT,
        })
      }),
    })
    const { app } = await server({ port })

    const accepted = await submit(app)
    const pending = await app.inject({
      method: "GET",
      url: `/v1/results/${RESULT_ID}`,
      headers: { ...hostHeaders, accept: "application/json" },
    })

    expect(accepted.statusCode).toBe(202)
    expect(pending.statusCode).toBe(202)
    expect(pending.json()).toMatchObject({ resultId: RESULT_ID, state: AI_ASYNC_OUTCOME_STATE.PENDING })
    if (complete === undefined) throw new TypeError("completion callback was not installed")
    complete()
    await new Promise<void>((resolve) => setImmediate(resolve))

    const completed = await app.inject({
      method: "GET",
      url: `/v1/results/${RESULT_ID}`,
      headers: { ...hostHeaders, accept: "application/json" },
    })
    expect(completed.statusCode).toBe(200)
    expect(completed.json()).toMatchObject({ resultId: RESULT_ID, state: AI_ASYNC_OUTCOME_STATE.COMPLETED })
  })

  it("uses only manager-provided identity and enforces owner authorization", async () => {
    const port = new TestExecutionPort({ ownerId: OTHER_OWNER_ID })
    const user = await server({ port })
    const operator = await server({
      port: new TestExecutionPort({ ownerId: OTHER_OWNER_ID }),
      identity: principal(OWNER_ID, PRINCIPAL_ROLE.OPERATOR),
    })
    const forged = await user.app.inject({
      method: "POST",
      url: "/v1/actions",
      headers: {
        ...hostHeaders,
        "content-type": "application/json",
        "x-principal-id": OTHER_OWNER_ID,
        "x-principal-role": PRINCIPAL_ROLE.OPERATOR,
      },
      payload: NAVIGATE_ACTION,
    })
    const allowed = await submit(operator.app)

    await new Promise<void>((resolve) => setImmediate(resolve))
    const forbidden = await user.app.inject({
      method: "GET",
      url: `/v1/results/${RESULT_ID}`,
      headers: hostHeaders,
    })

    expect(forged.statusCode).toBe(202)
    expect(forbidden.statusCode).toBe(403)
    expect(forbidden.json().error.code).toBe(MANAGED_ERROR_CODE.ACCESS_FORBIDDEN)
    expect(port.invocations[0]?.principal).toEqual(principal())
    expect(allowed.statusCode).toBe(202)
  })

  it("returns a binary descriptor by default and exact bytes only when requested", async () => {
    const port = new TestExecutionPort({ output: SCREENSHOT_COMPLETION, binaryBytes: SCREENSHOT_BYTES })
    const { app } = await server({ port })
    await submit(app, SCREENSHOT_ACTION)
    const descriptor = await app.inject({
      method: "GET",
      url: `/v1/results/${RESULT_ID}`,
      headers: { ...hostHeaders, accept: "application/json" },
    })
    const binary = await app.inject({
      method: "GET",
      url: `/v1/results/${RESULT_ID}`,
      headers: { ...hostHeaders, accept: "image/png" },
    })

    expect(descriptor.statusCode).toBe(200)
    expect(descriptor.json().result).toMatchObject({
      resultId: RESULT_ID,
      byteLength: SCREENSHOT_BYTES.byteLength,
      downloadUrl: `${PUBLIC_ORIGIN}/v1/results/${RESULT_ID}`,
    })
    expect(binary.statusCode).toBe(200)
    expect(binary.headers["content-type"]).toBe("image/png")
    expect(binary.rawPayload).toEqual(Buffer.from(SCREENSHOT_BYTES))
  })

  it("retains invalid adapter output as a typed terminal failure without leaking worker data", async () => {
    const port = new TestExecutionPort({ output: { ...NAVIGATION_OUTPUT, url: "http://worker-00:9223/private" } })
    const { app, transport } = await server({ port })
    const accepted = await submit(app)
    await new Promise<void>((resolve) => setImmediate(resolve))
    const failed = await app.inject({
      method: "GET",
      url: `/v1/results/${RESULT_ID}`,
      headers: hostHeaders,
    })

    expect(accepted.statusCode).toBe(202)
    expect(failed.statusCode).toBe(502)
    expect(failed.json().error.code).toBe(MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE)
    expect(failed.body).not.toContain("worker-00:9223")
    expect(transport.gauges()).toMatchObject({
      action: { active: 0 },
      result: { reservedCount: 1, retainedCount: 1, inFlightCount: 0 },
    })
  })

  it("returns stable media and result lookup errors", async () => {
    const { app } = await server()
    const media = await app.inject({
      method: "POST",
      url: "/v1/actions",
      headers: { ...hostHeaders, "content-type": "text/plain" },
      payload: JSON.stringify(NAVIGATE_ACTION),
    })
    const missing = await app.inject({
      method: "GET",
      url: `/v1/results/${RESULT_ID}`,
      headers: hostHeaders,
    })

    expect(media.statusCode).toBe(415)
    expect(media.json().error.code).toBe(MANAGED_ERROR_CODE.UNSUPPORTED_MEDIA_TYPE)
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error.code).toBe(MANAGED_ERROR_CODE.RESULT_NOT_FOUND)
  })
})
