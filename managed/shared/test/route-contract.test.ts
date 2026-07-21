import { describe, expect, it } from "vitest"

import { CONTROL_PLANE_API_VERSION } from "../src/control-plane-contract.js"
import { RESULT_KIND } from "../src/control-plane-vocabulary.js"
import {
  AI_ASYNC_OUTCOME_STATE,
  AI_ROUTE_REGISTRY,
  AI_ROUTE_PATH,
  createAiResultOutcomeSchema,
  CONTROL_PLANE_HTTP_METHOD,
  HTTP_RESPONSE_HEADER,
  HTTP_SUCCESS_STATUS,
  ROUTE_RESPONSE_KIND,
  createAiActionAcceptedOutcomeSchema,
  createAiResultBodySchema,
  type AiRoutePath,
} from "../src/route-contract.js"
import { selectPublicOrigin } from "../src/public-urls.js"
import { ActionAckSchema } from "../src/tool-result-schemas.js"

const RESULT_LOCATION = "https://steel.soungmin.kr/v1/results/418f56c8-6f7a-4c45-9e5d-77adff18f7ac"
const OTHER_RESULT_LOCATION = "https://steel.soungmin.kr/v1/results/518f56c8-6f7a-4c45-9e5d-77adff18f7ac"
const RESULT_ID = "418f56c8-6f7a-4c45-9e5d-77adff18f7ac"
const REQUEST_ID = "618f56c8-6f7a-4c45-9e5d-77adff18f7ac"
const CORRELATION_ID = "718f56c8-6f7a-4c45-9e5d-77adff18f7ac"
const SELECTED_ORIGIN = selectPublicOrigin("steel.soungmin.kr", {
  "steel.soungmin.kr": "https://steel.soungmin.kr",
})
const ACTION_ACCEPTED_OUTCOME_SCHEMA = createAiActionAcceptedOutcomeSchema(SELECTED_ORIGIN)
const RESULT_OUTCOME_SCHEMA = createAiResultOutcomeSchema(ActionAckSchema)
const RESULT_BODY_SCHEMA = createAiResultBodySchema(ActionAckSchema)
const COMPLETED_RESULT = {
  kind: RESULT_KIND.ACTION,
  sessionId: "018f56c8-6f7a-4c45-9e5d-77adff18f7ac",
  actionId: "118f56c8-6f7a-4c45-9e5d-77adff18f7ac",
  completedAt: "2026-07-21T08:00:00.000Z",
}

function aiRoute(path: AiRoutePath) {
  return AI_ROUTE_REGISTRY.find((route) => route.path === path)
}

describe("AI asynchronous route outcomes", () => {
  it("declares action acceptance as 202 with Location and Retry-After", () => {
    // Given: the public asynchronous action route.
    const route = aiRoute(AI_ROUTE_PATH.ACTIONS)
    expect(route?.method).toBe(CONTROL_PLANE_HTTP_METHOD.POST)
    // When: its success contract is inspected.
    // Then: acceptance is closed to 202 and both continuation headers.
    expect(route?.response).toEqual({
      kind: ROUTE_RESPONSE_KIND.ASYNC_ACTION,
      accepted: {
        state: AI_ASYNC_OUTCOME_STATE.ACCEPTED,
        status: HTTP_SUCCESS_STATUS.ACCEPTED,
        requiredHeaders: {
          [HTTP_RESPONSE_HEADER.LOCATION]: true,
          [HTTP_RESPONSE_HEADER.RETRY_AFTER]: true,
        },
      },
    })
  })

  it("rejects 200 action acceptance and either missing continuation header", () => {
    // Given: accepted action metadata and five status, header, and body mutations.
    const accepted = {
      status: HTTP_SUCCESS_STATUS.ACCEPTED,
      headers: {
        [HTTP_RESPONSE_HEADER.LOCATION]: RESULT_LOCATION,
        [HTTP_RESPONSE_HEADER.RETRY_AFTER]: "2",
      },
      body: {
        apiVersion: CONTROL_PLANE_API_VERSION,
        resultId: RESULT_ID,
        state: AI_ASYNC_OUTCOME_STATE.ACCEPTED,
        retryAfterSeconds: 2,
        requestId: REQUEST_ID,
        correlationId: CORRELATION_ID,
      },
    }
    expect(ACTION_ACCEPTED_OUTCOME_SCHEMA.safeParse(accepted).success).toBe(true)
    const mutations = [
      { ...accepted, status: HTTP_SUCCESS_STATUS.OK },
      { ...accepted, headers: { [HTTP_RESPONSE_HEADER.RETRY_AFTER]: "2" } },
      { ...accepted, headers: { [HTTP_RESPONSE_HEADER.LOCATION]: RESULT_LOCATION } },
      {
        ...accepted,
        headers: { ...accepted.headers, [HTTP_RESPONSE_HEADER.LOCATION]: OTHER_RESULT_LOCATION },
      },
      { ...accepted, body: { ...accepted.body, retryAfterSeconds: 3 } },
    ]
    // When: every mutation crosses the shared response boundary.
    const results = mutations.map((mutation) => ACTION_ACCEPTED_OUTCOME_SCHEMA.safeParse(mutation).success)
    // Then: none can masquerade as a valid accepted action.
    expect(results).toEqual([false, false, false, false, false])
  })

  it("distinguishes pending and completed result states", () => {
    // Given: one pending result and one completed result.
    const pending = {
      status: HTTP_SUCCESS_STATUS.ACCEPTED,
      headers: { [HTTP_RESPONSE_HEADER.RETRY_AFTER]: "2" },
      body: {
        apiVersion: CONTROL_PLANE_API_VERSION,
        resultId: RESULT_ID,
        state: AI_ASYNC_OUTCOME_STATE.PENDING,
        retryAfterSeconds: 2,
        requestId: REQUEST_ID,
        correlationId: CORRELATION_ID,
      },
    }
    const completed = {
      status: HTTP_SUCCESS_STATUS.OK,
      headers: {},
      body: {
        apiVersion: CONTROL_PLANE_API_VERSION,
        resultId: RESULT_ID,
        state: AI_ASYNC_OUTCOME_STATE.COMPLETED,
        result: COMPLETED_RESULT,
        requestId: REQUEST_ID,
        correlationId: CORRELATION_ID,
      },
    }
    // When: the discriminated result outcome boundary parses them.
    // Then: both legal state-specific transports are accepted.
    expect(RESULT_OUTCOME_SCHEMA.safeParse(pending).success).toBe(true)
    expect(RESULT_OUTCOME_SCHEMA.safeParse(completed).success).toBe(true)
    expect(RESULT_BODY_SCHEMA.safeParse(pending.body).success).toBe(true)
    expect(RESULT_BODY_SCHEMA.safeParse(completed.body).success).toBe(true)
  })

  it("rejects 202 completion, pending without Retry-After, and completed extra headers", () => {
    // Given: four mutations across completed and pending result states.
    const mutations = [
      {
        status: HTTP_SUCCESS_STATUS.ACCEPTED,
        headers: {},
        body: {
          apiVersion: CONTROL_PLANE_API_VERSION,
          resultId: RESULT_ID,
          state: AI_ASYNC_OUTCOME_STATE.COMPLETED,
          result: COMPLETED_RESULT,
          requestId: REQUEST_ID,
          correlationId: CORRELATION_ID,
        },
      },
      {
        status: HTTP_SUCCESS_STATUS.ACCEPTED,
        headers: {},
        body: {
          apiVersion: CONTROL_PLANE_API_VERSION,
          resultId: RESULT_ID,
          state: AI_ASYNC_OUTCOME_STATE.PENDING,
          retryAfterSeconds: 2,
          requestId: REQUEST_ID,
          correlationId: CORRELATION_ID,
        },
      },
      {
        status: HTTP_SUCCESS_STATUS.OK,
        headers: { [HTTP_RESPONSE_HEADER.RETRY_AFTER]: "2" },
        body: {
          apiVersion: CONTROL_PLANE_API_VERSION,
          resultId: RESULT_ID,
          state: AI_ASYNC_OUTCOME_STATE.COMPLETED,
          result: COMPLETED_RESULT,
          requestId: REQUEST_ID,
          correlationId: CORRELATION_ID,
        },
      },
      {
        status: HTTP_SUCCESS_STATUS.ACCEPTED,
        headers: { [HTTP_RESPONSE_HEADER.RETRY_AFTER]: "2" },
        body: {
          apiVersion: CONTROL_PLANE_API_VERSION,
          resultId: RESULT_ID,
          state: AI_ASYNC_OUTCOME_STATE.PENDING,
          retryAfterSeconds: 3,
          requestId: REQUEST_ID,
          correlationId: CORRELATION_ID,
        },
      },
    ]
    // When: every mutation crosses the shared result boundary.
    const results = mutations.map((mutation) => RESULT_OUTCOME_SCHEMA.safeParse(mutation).success)
    // Then: the state-specific status and exact header contracts reject all four.
    expect(results).toEqual([false, false, false, false])
  })

  it("declares pending and completed outcomes on the result route", () => {
    // Given: the asynchronous result retrieval route.
    const route = aiRoute(AI_ROUTE_PATH.RESULT)
    expect(route?.method).toBe(CONTROL_PLANE_HTTP_METHOD.GET)
    // When: its response contract is inspected.
    // Then: pending and completed transports remain independently typed.
    expect(route?.response).toEqual({
      kind: ROUTE_RESPONSE_KIND.ASYNC_RESULT,
      pending: {
        state: AI_ASYNC_OUTCOME_STATE.PENDING,
        status: HTTP_SUCCESS_STATUS.ACCEPTED,
        requiredHeaders: { [HTTP_RESPONSE_HEADER.RETRY_AFTER]: true },
      },
      completed: {
        state: AI_ASYNC_OUTCOME_STATE.COMPLETED,
        status: HTTP_SUCCESS_STATUS.OK,
        requiredHeaders: {},
      },
    })
  })
})
