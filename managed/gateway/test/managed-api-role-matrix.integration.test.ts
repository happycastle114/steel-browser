import { afterEach, describe, expect, it } from "vitest";
import {
  CONTROL_PLANE_HTTP_METHOD,
  MANAGED_ADMISSION_OPERATION,
  MANAGER_MODE_CAUSE,
  type HttpMethod,
} from "@happycastle/steel-managed-shared";
import {
  ADMISSION_A_ID,
  ADMISSION_B,
  IDEMPOTENCY_KEY,
  MANAGER_INSTANCE_ID,
  OPERATOR,
  SESSION_A_ID,
  SESSION_B,
  USER_A,
  buildManagedApi,
} from "./managed-api-test-support.js";

type RoleRouteCase = Readonly<{
  method: HttpMethod;
  operatorStatus: number;
  path: string;
  payload?: Readonly<Record<string, unknown>>;
  userStatus: number;
}>;

const drainPayload = {
  idempotencyKey: IDEMPOTENCY_KEY,
  expectedManagerInstanceId: MANAGER_INSTANCE_ID,
  deadlineAt: new Date(61_000).toISOString(),
  reason: MANAGER_MODE_CAUSE.CUTOVER,
};

const resumePayload = {
  idempotencyKey: IDEMPOTENCY_KEY,
  expectedManagerInstanceId: MANAGER_INSTANCE_ID,
  expectedSafeAt: new Date(61_000).toISOString(),
  reason: MANAGER_MODE_CAUSE.RECOVERY,
};

const ROLE_ROUTE_CASES: readonly RoleRouteCase[] = [
  {
    method: CONTROL_PLANE_HTTP_METHOD.GET,
    path: "/v1/managed/pool",
    operatorStatus: 200,
    userStatus: 200,
  },
  {
    method: CONTROL_PLANE_HTTP_METHOD.GET,
    path: "/v1/managed/workers",
    operatorStatus: 200,
    userStatus: 403,
  },
  {
    method: CONTROL_PLANE_HTTP_METHOD.GET,
    path: "/v1/managed/sessions",
    operatorStatus: 200,
    userStatus: 200,
  },
  {
    method: CONTROL_PLANE_HTTP_METHOD.GET,
    path: `/v1/managed/sessions/${SESSION_A_ID}`,
    operatorStatus: 200,
    userStatus: 200,
  },
  {
    method: CONTROL_PLANE_HTTP_METHOD.GET,
    path: "/v1/managed/queue",
    operatorStatus: 200,
    userStatus: 403,
  },
  {
    method: CONTROL_PLANE_HTTP_METHOD.GET,
    path: "/v1/managed/events",
    operatorStatus: 200,
    userStatus: 403,
  },
  {
    method: CONTROL_PLANE_HTTP_METHOD.GET,
    path: `/v1/managed/admissions/${ADMISSION_A_ID}`,
    operatorStatus: 200,
    userStatus: 200,
  },
  {
    method: CONTROL_PLANE_HTTP_METHOD.GET,
    path: "/v1/managed/version",
    operatorStatus: 200,
    userStatus: 200,
  },
  {
    method: CONTROL_PLANE_HTTP_METHOD.POST,
    path: "/v1/managed/admissions",
    payload: {
      idempotencyKey: IDEMPOTENCY_KEY,
      operation: MANAGED_ADMISSION_OPERATION.SESSION_CREATE,
    },
    operatorStatus: 202,
    userStatus: 202,
  },
  {
    method: CONTROL_PLANE_HTTP_METHOD.POST,
    path: `/v1/managed/admissions/${ADMISSION_A_ID}/cancel`,
    payload: {},
    operatorStatus: 200,
    userStatus: 200,
  },
  {
    method: CONTROL_PLANE_HTTP_METHOD.POST,
    path: `/v1/managed/sessions/${SESSION_A_ID}/release`,
    payload: {},
    operatorStatus: 200,
    userStatus: 200,
  },
  {
    method: CONTROL_PLANE_HTTP_METHOD.POST,
    path: "/v1/managed/pool/drain",
    payload: drainPayload,
    operatorStatus: 200,
    userStatus: 403,
  },
  {
    method: CONTROL_PLANE_HTTP_METHOD.POST,
    path: "/v1/managed/pool/resume",
    payload: resumePayload,
    operatorStatus: 200,
    userStatus: 403,
  },
];

const apps: Array<Awaited<ReturnType<typeof buildManagedApi>>["app"]> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function statusFor(
  principal: typeof USER_A,
  route: RoleRouteCase,
): Promise<number> {
  const { app } = await buildManagedApi(principal);
  apps.push(app);
  const response = await app.inject({
    method: route.method,
    url: route.path,
    ...(route.payload === undefined ? {} : { payload: route.payload }),
  });
  return response.statusCode;
}

describe("managed API role matrix", () => {
  it("enforces every USER row in the exact route allowlist", async () => {
    // Given / When
    const statuses = await Promise.all(
      ROLE_ROUTE_CASES.map((route) => statusFor(USER_A, route)),
    );

    // Then
    expect(statuses).toEqual(
      ROLE_ROUTE_CASES.map(({ userStatus }) => userStatus),
    );
  });

  it("allows OPERATOR on every route in the exact allowlist", async () => {
    // Given / When
    const statuses = await Promise.all(
      ROLE_ROUTE_CASES.map((route) => statusFor(OPERATOR, route)),
    );

    // Then
    expect(statuses).toEqual(
      ROLE_ROUTE_CASES.map(({ operatorStatus }) => operatorStatus),
    );
  });

  it("allows OPERATOR detail and mutations across ownership boundaries", async () => {
    // Given
    const { app } = await buildManagedApi(OPERATOR);
    apps.push(app);

    // When
    const sessionDetail = await app.inject({
      method: "GET",
      url: `/v1/managed/sessions/${SESSION_B.sessionId}`,
    });
    const admissionDetail = await app.inject({
      method: "GET",
      url: `/v1/managed/admissions/${ADMISSION_B.admissionId}`,
    });
    const release = await app.inject({
      method: "POST",
      url: `/v1/managed/sessions/${SESSION_B.sessionId}/release`,
      payload: {},
    });
    const cancel = await app.inject({
      method: "POST",
      url: `/v1/managed/admissions/${ADMISSION_B.admissionId}/cancel`,
      payload: {},
    });

    // Then
    expect([
      sessionDetail.statusCode,
      admissionDetail.statusCode,
      release.statusCode,
      cancel.statusCode,
    ]).toEqual([200, 200, 200, 200]);
  });
});
