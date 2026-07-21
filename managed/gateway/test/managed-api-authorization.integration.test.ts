import { afterEach, describe, expect, it } from "vitest";
import {
  MANAGED_ERROR_CODE,
  SessionListSchema,
} from "@happycastle/steel-managed-shared";
import {
  MISSING_SESSION_ID,
  OPERATOR,
  SESSION_A_ID,
  SESSION_B,
  USER_A,
  USER_B,
  buildManagedApi,
} from "./managed-api-test-support.js";

const apps: Array<Awaited<ReturnType<typeof buildManagedApi>>["app"]> = [];

class AuthorizationTestError extends Error {
  public override readonly name = "AuthorizationTestError";
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function api(principal: typeof USER_A) {
  const built = await buildManagedApi(principal);
  apps.push(built.app);
  return built;
}

function errorContract(response: {
  readonly json: () => unknown;
  readonly statusCode: number;
}) {
  const body = response.json();
  if (typeof body !== "object" || body === null || !("error" in body))
    throw new AuthorizationTestError("missing error envelope");
  return { body, status: response.statusCode };
}

describe("managed API authorization", () => {
  it.each(["/v1/managed/workers", "/v1/managed/queue", "/v1/managed/events"])(
    "denies USER on operator route %s before capture or cursor allocation",
    async (url) => {
      // Given
      const { app, port } = await api(USER_A);

      // When
      const response = await app.inject({
        method: "GET",
        url: `${url}?cursor=malformed+cursor`,
      });

      // Then
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error: { code: MANAGED_ERROR_CODE.ACCESS_FORBIDDEN },
      });
      expect(port.captures).toBe(0);
    },
  );

  it("captures only USER-owned sessions before creating the immutable snapshot", async () => {
    // Given
    const { app } = await api(USER_A);

    // When
    const response = await app.inject({
      method: "GET",
      url: "/v1/managed/sessions?pageSize=100",
    });

    // Then
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{ sessionId: SESSION_A_ID }],
      page: { hasMore: false },
    });
  });

  it("allows OPERATOR to capture the global session projection", async () => {
    // Given
    const { app } = await api(OPERATOR);

    // When
    const response = await app.inject({
      method: "GET",
      url: "/v1/managed/sessions?pageSize=100",
    });

    // Then
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{ sessionId: SESSION_B.sessionId }, { sessionId: SESSION_A_ID }],
    });
  });

  it("serves continuation pages from the frozen projection without a live capture", async () => {
    // Given
    const { app, port } = await api(OPERATOR);
    const firstResponse = await app.inject({
      method: "GET",
      url: "/v1/managed/sessions?pageSize=1",
    });
    const first = SessionListSchema.parse(firstResponse.json());
    port.sessions = [];

    // When
    const secondResponse = await app.inject({
      method: "GET",
      url: `/v1/managed/sessions?cursor=${first.page.nextCursor}`,
    });
    const second = SessionListSchema.parse(secondResponse.json());

    // Then
    expect(second.items).toMatchObject([{ sessionId: SESSION_A_ID }]);
    expect(port.captures).toBe(1);
  });

  it("makes cross-principal and missing session detail indistinguishable", async () => {
    // Given
    const { app } = await api(USER_A);

    // When
    const crossPrincipal = await app.inject({
      method: "GET",
      url: `/v1/managed/sessions/${SESSION_B.sessionId}`,
    });
    const missing = await app.inject({
      method: "GET",
      url: `/v1/managed/sessions/${MISSING_SESSION_ID}`,
    });

    // Then
    const crossContract = errorContract(crossPrincipal);
    const missingContract = errorContract(missing);
    expect(crossContract.status).toBe(404);
    expect(crossContract.body).toMatchObject({
      error: { code: MANAGED_ERROR_CODE.SESSION_NOT_FOUND },
    });
    expect(missingContract.body).toMatchObject({
      error: { code: MANAGED_ERROR_CODE.SESSION_NOT_FOUND },
    });
  });

  it("blocks a cross-principal release before the domain mutation port", async () => {
    // Given
    const { app, port } = await api(USER_B);

    // When
    const response = await app.inject({
      method: "POST",
      url: `/v1/managed/sessions/${SESSION_A_ID}/release`,
      payload: {},
    });

    // Then
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: MANAGED_ERROR_CODE.SESSION_NOT_FOUND },
    });
    expect(port.mutations).toBe(0);
  });
});
