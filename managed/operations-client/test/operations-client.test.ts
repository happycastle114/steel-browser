import { describe, expect, it } from "vitest";
import {
  CONTROL_PLANE_API_VERSION,
  MANAGED_ADMISSION_OPERATION,
  MANAGED_ERROR_CODE,
  SESSION_STATE,
} from "@happycastle/steel-managed-shared/browser";
import {
  ADMISSION_ID,
  OTHER_ADMISSION_ID,
  OTHER_SESSION_ID,
  SESSION_ID,
  admission,
  clientWith,
  session,
  success,
  type RecordedRequest,
} from "./operations-client-test-support.js";

describe("ManagedOperationsClient", () => {
  it("encodes cursor, page size, and repeated enum state query parameters", async () => {
    // Given
    const requests: RecordedRequest[] = [];
    const api = clientWith(
      [
        success({
          apiVersion: CONTROL_PLANE_API_VERSION,
          items: [session()],
          page: { pageSize: 1, snapshotCursor: "aa", hasMore: false },
        }),
      ],
      requests,
    );

    // When
    const result = await api.listSessions({
      cursor: "bb",
      pageSize: 1,
      state: [SESSION_STATE.LIVE, SESSION_STATE.STARTING],
    });

    // Then
    expect(result.items).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      request: { method: "GET" },
      url: "https://steel.example.test/v1/managed/sessions?cursor=bb&pageSize=1&state=LIVE&state=STARTING",
    });
  });

  it.each([
    [
      "session detail",
      () =>
        clientWith([success(session(OTHER_SESSION_ID))]).getSession(SESSION_ID),
    ],
    [
      "session release",
      () =>
        clientWith([success(session(OTHER_SESSION_ID))]).releaseSession(
          SESSION_ID,
        ),
    ],
    [
      "admission detail",
      () =>
        clientWith([success(admission(OTHER_ADMISSION_ID))]).getAdmission(
          ADMISSION_ID,
        ),
    ],
    [
      "admission cancel",
      () =>
        clientWith([success(admission(OTHER_ADMISSION_ID))]).cancelAdmission(
          ADMISSION_ID,
        ),
    ],
  ])("rejects wrong requested-ID binding for %s", async (_scenario, action) => {
    // Given / When
    const request = action();

    // Then
    await expect(request).rejects.toMatchObject({
      name: "ManagedApiProtocolError",
    });
  });

  it("returns a same-ID session after schema and identity validation", async () => {
    // Given
    const api = clientWith([success(session())]);

    // When
    const result = await api.getSession(SESSION_ID);

    // Then
    expect(result.sessionId).toBe(SESSION_ID);
  });

  it("surfaces only a validated managed error envelope", async () => {
    // Given
    const response = {
      ok: false,
      status: 403,
      json: async () => ({
        apiVersion: CONTROL_PLANE_API_VERSION,
        error: {
          code: MANAGED_ERROR_CODE.ACCESS_FORBIDDEN,
          message: "Forbidden",
          retryable: false,
          requestId: "00000000-0000-4000-8000-000000000099",
        },
      }),
    };
    const api = clientWith([response]);

    // When
    const request = api.listWorkers();

    // Then
    await expect(request).rejects.toMatchObject({
      name: "ManagedApiError",
      status: 403,
      envelope: { error: { code: MANAGED_ERROR_CODE.ACCESS_FORBIDDEN } },
    });
  });

  it("rejects a schema-valid body returned with the wrong success status", async () => {
    // Given
    const api = clientWith([{ ...success(session()), status: 201 }]);

    // When
    const request = api.getSession(SESSION_ID);

    // Then
    await expect(request).rejects.toMatchObject({
      name: "ManagedApiProtocolError",
    });
  });

  it("rejects an error code whose catalog status differs from the HTTP status", async () => {
    // Given
    const api = clientWith([
      {
        ok: false,
        status: 404,
        json: async () => ({
          apiVersion: CONTROL_PLANE_API_VERSION,
          error: {
            code: MANAGED_ERROR_CODE.ACCESS_FORBIDDEN,
            message: "Forbidden",
            retryable: false,
            requestId: "00000000-0000-4000-8000-000000000099",
          },
        }),
      },
    ]);

    // When
    const request = api.listWorkers();

    // Then
    await expect(request).rejects.toMatchObject({
      name: "ManagedApiProtocolError",
    });
  });

  it("validates mutation input before invoking fetch", () => {
    // Given
    const requests: RecordedRequest[] = [];
    const api = clientWith([], requests);

    // When
    const create = () =>
      api.createAdmission({
        idempotencyKey: "short",
        operation: MANAGED_ADMISSION_OPERATION.SESSION_CREATE,
      });

    // Then
    expect(create).toThrow();
    expect(requests).toEqual([]);
  });

  it("validates list queries and resource IDs before invoking fetch", async () => {
    // Given
    const requests: RecordedRequest[] = [];
    const api = clientWith([], requests);

    // When
    const invalidList = () => api.listSessions({ pageSize: 0 });
    const invalidDetail = Reflect.apply(api.getSession, api, ["invalid-id"]);

    // Then
    expect(invalidList).toThrow();
    await expect(invalidDetail).rejects.toBeDefined();
    expect(requests).toEqual([]);
  });
});
