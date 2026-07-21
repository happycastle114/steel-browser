import { afterEach, describe, expect, it } from "vitest";
import {
  ADMISSION_STATE,
  CONTROL_PLANE_API_VERSION,
  EVENT_TYPE,
  MANAGED_ADMISSION_OPERATION,
  MANAGED_ERROR_CODE,
  MANAGER_MODE,
  MANAGER_MODE_CAUSE,
  SESSION_STATE,
} from "@happycastle/steel-managed-shared";
import type { ManagedEventDraft } from "../src/api/operations/index.js";
import {
  ADMISSION_A_ID,
  IDEMPOTENCY_KEY,
  MISSING_ADMISSION_ID,
  OPERATOR,
  SESSION_A_ID,
  USER_A,
  USER_B,
  RecordingOperationsPort,
  buildManagedApi,
  pool,
} from "./managed-api-test-support.js";

const apps: Array<Awaited<ReturnType<typeof buildManagedApi>>["app"]> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function api(
  principal: typeof USER_A,
  port = new RecordingOperationsPort(),
) {
  const built = await buildManagedApi(principal, port);
  apps.push(built.app);
  return built;
}

function sessionEvent(): ManagedEventDraft {
  return {
    type: EVENT_TYPE.SESSION_STATE_CHANGED,
    sessionId: SESSION_A_ID,
    payload: { from: SESSION_STATE.QUEUED, to: SESSION_STATE.STARTING },
  };
}

describe("managed API resource mutations", () => {
  it("validates create input and returns the accepted admission contract", async () => {
    // Given
    const { app, port } = await api(USER_A);

    // When
    const accepted = await app.inject({
      method: "POST",
      url: "/v1/managed/admissions",
      payload: {
        idempotencyKey: IDEMPOTENCY_KEY,
        operation: MANAGED_ADMISSION_OPERATION.SESSION_CREATE,
      },
    });
    const invalid = await app.inject({
      method: "POST",
      url: "/v1/managed/admissions",
      payload: {
        idempotencyKey: IDEMPOTENCY_KEY,
        operation: MANAGED_ADMISSION_OPERATION.SESSION_CREATE,
        extra: true,
      },
    });

    // Then
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toMatchObject({
      admissionId: ADMISSION_A_ID,
      state: ADMISSION_STATE.QUEUED,
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      error: { code: MANAGED_ERROR_CODE.INVALID_ARGUMENT },
    });
    expect(port.mutations).toBe(1);
  });

  it("returns only allowed terminal states for cancel and release", async () => {
    // Given
    const { app } = await api(USER_A);

    // When
    const cancelled = await app.inject({
      method: "POST",
      url: `/v1/managed/admissions/${ADMISSION_A_ID}/cancel`,
      payload: {},
    });
    const released = await app.inject({
      method: "POST",
      url: `/v1/managed/sessions/${SESSION_A_ID}/release`,
      payload: {},
    });

    // Then
    expect(cancelled.json()).toMatchObject({
      state: ADMISSION_STATE.CANCELLED,
    });
    expect(released.json()).toMatchObject({ state: SESSION_STATE.RELEASED });
  });

  it("makes cross-principal and absent admissions indistinguishable", async () => {
    // Given
    const { app } = await api(USER_B);

    // When
    const crossPrincipal = await app.inject({
      method: "GET",
      url: `/v1/managed/admissions/${ADMISSION_A_ID}`,
    });
    const missing = await app.inject({
      method: "GET",
      url: `/v1/managed/admissions/${MISSING_ADMISSION_ID}`,
    });

    // Then
    expect([crossPrincipal.statusCode, missing.statusCode]).toEqual([404, 404]);
    expect(crossPrincipal.json()).toMatchObject({
      error: { code: MANAGED_ERROR_CODE.ADMISSION_NOT_FOUND },
    });
    expect(missing.json()).toMatchObject({
      error: { code: MANAGED_ERROR_CODE.ADMISSION_NOT_FOUND },
    });
  });

  it("reads boot-recovered drain state without synthesizing an event", async () => {
    // Given
    const port = new RecordingOperationsPort();
    port.currentPool = pool(MANAGER_MODE.DRAINING, MANAGER_MODE_CAUSE.RECOVERY);
    const { app } = await api(OPERATOR, port);

    // When
    const poolResponse = await app.inject({
      method: "GET",
      url: "/v1/managed/pool",
    });
    const eventResponse = await app.inject({
      method: "GET",
      url: "/v1/managed/events",
    });

    // Then
    expect(poolResponse.json()).toMatchObject({
      apiVersion: CONTROL_PLANE_API_VERSION,
      mode: MANAGER_MODE.DRAINING,
      handover: {
        cause: MANAGER_MODE_CAUSE.RECOVERY,
        drainEnteredAt: new Date(0).toISOString(),
        idempotencyTtlMs: 60_000,
        safeAt: new Date(61_000).toISOString(),
      },
    });
    expect(eventResponse.json()).toMatchObject({ items: [] });
  });

  it("exposes events and the immutable version resource over HTTP", async () => {
    // Given
    const { app, events } = await api(OPERATOR);
    events.append(sessionEvent());

    // When
    const eventResponse = await app.inject({
      method: "GET",
      url: "/v1/managed/events?pageSize=1",
    });
    const versionResponse = await app.inject({
      method: "GET",
      url: "/v1/managed/version",
    });

    // Then
    expect(eventResponse.json()).toMatchObject({
      items: [{ sequence: "1", type: EVENT_TYPE.SESSION_STATE_CHANGED }],
    });
    expect(versionResponse.json()).toMatchObject({
      apiVersion: CONTROL_PLANE_API_VERSION,
      upstreamSha: "1".repeat(40),
    });
  });
});
