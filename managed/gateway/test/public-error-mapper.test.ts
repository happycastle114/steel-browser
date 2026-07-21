import { describe, expect, it } from "vitest"
import {
  AmbiguousSessionAffinityError,
  SessionNotFoundError,
  WorkerIdentityMismatchError,
} from "../src/domain/errors.js"
import { publicSessionId, instanceId } from "./test-support.js"
import { WorkerIdSchema } from "../src/domain/ids.js"
import {
  MethodNotAllowedError,
  PublicErrorCode,
  UnsupportedFeature,
  UnsupportedFeatureError,
  mapPublicError,
} from "../src/api/public/error-mapper.js"
import { PublicHttpMethod } from "../src/api/public/schemas.js"
import {
  PublicRequestBodyTooLargeError,
  WorkerRestTimeoutError,
} from "../src/api/public/proxy.js"

const REQUEST_ID = "request-1"

function parsedBody(response: ReturnType<typeof mapPublicError>) {
  return JSON.parse(response.body.toString("utf8"))
}

describe("mapPublicError", () => {
  it.each([
    {
      error: new SessionNotFoundError(publicSessionId(1)),
      code: PublicErrorCode.SESSION_NOT_FOUND,
      statusCode: 404,
    },
    {
      error: new AmbiguousSessionAffinityError(2),
      code: PublicErrorCode.MANAGED_SESSION_REQUIRED,
      statusCode: 409,
    },
    {
      error: new WorkerIdentityMismatchError(WorkerIdSchema.parse("worker-00"), instanceId(1)),
      code: PublicErrorCode.INSTANCE_LOST,
      statusCode: 410,
    },
    {
      error: new WorkerRestTimeoutError(),
      code: PublicErrorCode.UPSTREAM_TIMEOUT,
      statusCode: 504,
    },
    {
      error: new PublicRequestBodyTooLargeError(),
      code: PublicErrorCode.BODY_TOO_LARGE,
      statusCode: 413,
    },
  ])("maps $code into the closed error catalog", ({ error, code, statusCode }) => {
    // Given / When
    const response = mapPublicError(error, REQUEST_ID)

    // Then
    expect(response.statusCode).toBe(statusCode)
    expect(parsedBody(response)).toMatchObject({ error: { code, requestId: REQUEST_ID } })
  })

  it("returns exact Allow for a known route method error", () => {
    // Given
    const error = new MethodNotAllowedError([PublicHttpMethod.GET, PublicHttpMethod.HEAD])

    // When
    const response = mapPublicError(error, REQUEST_ID)

    // Then
    expect(response.statusCode).toBe(405)
    expect(response.headers["allow"]).toBe("GET, HEAD")
    expect(parsedBody(response)).toMatchObject({
      error: { code: PublicErrorCode.METHOD_NOT_ALLOWED },
    })
  })

  it("links an exact Cloud-only input to capability discovery without echoing its value", () => {
    // Given
    const error = new UnsupportedFeatureError(UnsupportedFeature.SOLVE_CAPTCHA)

    // When
    const response = mapPublicError(error, REQUEST_ID)
    const serialized = response.body.toString("utf8")

    // Then
    expect(response.statusCode).toBe(422)
    expect(parsedBody(response)).toMatchObject({
      error: {
        code: PublicErrorCode.MANAGED_FEATURE_UNSUPPORTED,
        details: { capabilityUrl: "/v1/capabilities", feature: "solveCaptcha" },
      },
    })
    expect(serialized).not.toContain("secret")
  })
})
