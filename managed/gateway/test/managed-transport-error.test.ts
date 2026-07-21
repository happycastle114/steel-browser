import {
  MANAGED_ERROR_CODE,
  RETRY_POLICY_CAUSE,
  UuidSchema,
  retryMetadataFor,
} from "@happycastle/steel-managed-shared"
import Fastify from "fastify"
import { describe, expect, it } from "vitest"

import {
  ManagedTransportError,
  sendManagedError,
} from "../src/api/managed/transport-error.js"

describe("managed transport retry errors", () => {
  it("keeps Retry-After synchronized with the stable error envelope", async () => {
    const retry = retryMetadataFor({
      cause: RETRY_POLICY_CAUSE.ACTION_CAPACITY,
      reconcileMs: 1_200,
    })
    const app = Fastify({ logger: false })
    app.get("/", async (_request, reply) => {
      sendManagedError(reply, {
        requestId: UuidSchema.parse("11111111-1111-4111-8111-111111111111"),
        correlationId: UuidSchema.parse("22222222-2222-4222-8222-222222222222"),
      }, new ManagedTransportError(
        retry.errorCode,
        "Action capacity is exhausted",
        { details: retry.details, retryAfterSeconds: retry.retryAfterSeconds },
      ))
    })

    const response = await app.inject({ method: "GET", url: "/" })
    await app.close()

    expect(response.statusCode).toBe(503)
    expect(response.headers["retry-after"]).toBe("2")
    expect(response.json()).toMatchObject({
      error: {
        code: MANAGED_ERROR_CODE.MANAGED_ACTION_CAPACITY,
        details: { retryAfterSeconds: 2 },
      },
    })
  })
})
