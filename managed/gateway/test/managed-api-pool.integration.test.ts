import { afterEach, describe, expect, it } from "vitest";
import {
  MANAGED_ERROR_CODE,
  MANAGER_MODE,
  MANAGER_MODE_CAUSE,
  type ManagerModeCause,
} from "@happycastle/steel-managed-shared";
import {
  IDEMPOTENCY_KEY,
  MANAGER_INSTANCE_ID,
  OPERATOR,
  USER_A,
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

function drainBody(reason: ManagerModeCause = MANAGER_MODE_CAUSE.CUTOVER) {
  return {
    idempotencyKey: IDEMPOTENCY_KEY,
    expectedManagerInstanceId: MANAGER_INSTANCE_ID,
    deadlineAt: new Date(61_000).toISOString(),
    reason,
  };
}

function resumeBody() {
  return {
    idempotencyKey: IDEMPOTENCY_KEY,
    expectedManagerInstanceId: MANAGER_INSTANCE_ID,
    expectedSafeAt: new Date(61_000).toISOString(),
    reason: MANAGER_MODE_CAUSE.RECOVERY,
  };
}

describe("managed API pool mutations", () => {
  it("rejects USER pool mutations before parsing the body", async () => {
    // Given
    const { app, port } = await api(USER_A);

    // When
    const drain = await app.inject({
      method: "POST",
      url: "/v1/managed/pool/drain",
      payload: {},
    });
    const resume = await app.inject({
      method: "POST",
      url: "/v1/managed/pool/resume",
      payload: {},
    });

    // Then
    expect([drain.statusCode, resume.statusCode]).toEqual([403, 403]);
    expect(port.mutations).toBe(0);
  });

  it("replays identical drain and rejects changed content without another mutation", async () => {
    // Given
    const { app, port } = await api(OPERATOR);
    const request = drainBody();

    // When
    const first = await app.inject({
      method: "POST",
      url: "/v1/managed/pool/drain",
      payload: request,
    });
    const replay = await app.inject({
      method: "POST",
      url: "/v1/managed/pool/drain",
      payload: request,
    });
    const conflict = await app.inject({
      method: "POST",
      url: "/v1/managed/pool/drain",
      payload: drainBody(MANAGER_MODE_CAUSE.ROLLBACK),
    });

    // Then
    expect(first.statusCode).toBe(200);
    expect(first.body).toBe(replay.body);
    expect(first.json()).toMatchObject({
      mode: MANAGER_MODE.DRAINING,
      handover: {
        cause: MANAGER_MODE_CAUSE.CUTOVER,
        idempotencyTtlMs: 60_000,
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      error: { code: MANAGED_ERROR_CODE.SESSION_STATE_CONFLICT },
    });
    expect(port.mutations).toBe(1);
  });

  it("resumes a draining pool with the exact serving resource", async () => {
    // Given
    const port = new RecordingOperationsPort();
    port.currentPool = pool(MANAGER_MODE.DRAINING);
    const { app } = await api(OPERATOR, port);

    // When
    const response = await app.inject({
      method: "POST",
      url: "/v1/managed/pool/resume",
      payload: resumeBody(),
    });

    // Then
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      mode: MANAGER_MODE.SERVING,
      handover: { mode: MANAGER_MODE.SERVING },
    });
  });
});
