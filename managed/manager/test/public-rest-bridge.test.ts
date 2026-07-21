import { Readable } from "node:stream"
import Fastify from "fastify"
import { PublicHttpMethod } from "@happycastle/steel-managed-gateway"
import { afterEach, describe, expect, it } from "vitest"
import { registerPublicRestBridge } from "../src/http/public-rest-bridge.js"

describe("public REST Fastify bridge", () => {
  const applications = new Set<ReturnType<typeof Fastify>>()

  afterEach(async () => {
    await Promise.all([...applications].map(async (app) => app.close()))
    applications.clear()
  })

  it("forwards exact method, path, headers, and body to the public gateway", async () => {
    const app = Fastify()
    applications.add(app)
    let observed: unknown
    registerPublicRestBridge(app, {
      gateway: {
        handle: async (input) => {
          observed = input
          return {
            body: Buffer.from("accepted"),
            headers: { "content-type": "text/plain; charset=utf-8" },
            statusCode: 202,
          }
        },
      },
    })

    const response = await app.inject({
      headers: { host: "steel.example.com" },
      method: "POST",
      payload: { sessionId: "fixture" },
      url: "/v1/sessions?source=compatibility",
    })

    expect(response.statusCode).toBe(202)
    expect(response.body).toBe("accepted")
    expect(observed).toMatchObject({
      method: PublicHttpMethod.POST,
      pathAndQuery: "/v1/sessions?source=compatibility",
    })
    const body = Reflect.get(observed ?? {}, "body")
    if (!Buffer.isBuffer(body)) throw new TypeError("expected buffered body")
    expect(JSON.parse(body.toString("utf8"))).toEqual({
      sessionId: "fixture",
    })
  })

  it("keeps streaming responses on Fastify's response lifecycle", async () => {
    const app = Fastify()
    applications.add(app)
    registerPublicRestBridge(app, {
      gateway: {
        handle: async () => ({
          body: Readable.from(["one", "-two"]),
          cancel: () => undefined,
          closed: Promise.resolve(),
          headers: { "content-type": "text/plain; charset=utf-8" },
          statusCode: 200,
          streaming: true,
        }),
      },
    })

    const response = await app.inject({ method: "GET", url: "/v1/logs/stream" })

    expect(response.statusCode).toBe(200)
    expect(response.body).toBe("one-two")
  })
})
