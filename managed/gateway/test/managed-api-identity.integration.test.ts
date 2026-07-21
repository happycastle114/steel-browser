import { afterEach, describe, expect, it } from "vitest";
import {
  ADMISSION_STATE,
  AdmissionSchema,
  CONTROL_PLANE_API_VERSION,
  MANAGED_ERROR_CODE,
  MANAGER_MODE_CAUSE,
  ManagerInstanceIdSchema,
  SESSION_STATE,
  SessionSchema,
  type Admission,
  type AdmissionId,
  type OwnedAuthorizationResource,
  type Session,
  type SessionId,
} from "@happycastle/steel-managed-shared";
import type {
  ManagedAdmissionMutationCommand,
  ManagedSessionReleaseCommand,
} from "../src/api/operations/index.js";
import {
  ADMISSION_A_ID,
  ADMISSION_B,
  IDEMPOTENCY_KEY,
  OPERATOR,
  SESSION_A_ID,
  SESSION_B,
  USER_A,
  USER_A_ID,
  RecordingOperationsPort,
  buildManagedApi,
  uuid,
} from "./managed-api-test-support.js";

class WrongDetailIdentityPort extends RecordingOperationsPort {
  public override async findAdmission(
    _admissionId: AdmissionId,
  ): Promise<OwnedAuthorizationResource<Admission>> {
    return { ownerId: USER_A_ID, resource: ADMISSION_B };
  }

  public override async findSession(
    _sessionId: SessionId,
  ): Promise<OwnedAuthorizationResource<Session>> {
    return { ownerId: USER_A_ID, resource: SESSION_B };
  }
}

class WrongMutationIdentityPort extends RecordingOperationsPort {
  public override async cancelAdmission(
    _command: ManagedAdmissionMutationCommand,
  ): Promise<Admission> {
    return AdmissionSchema.parse({
      ...ADMISSION_B,
      state: ADMISSION_STATE.CANCELLED,
      updatedAt: new Date(2_000).toISOString(),
    });
  }

  public override async releaseSession(
    _command: ManagedSessionReleaseCommand,
  ): Promise<Session> {
    return SessionSchema.parse({
      ...SESSION_B,
      state: SESSION_STATE.RELEASED,
      endedAt: new Date(2_000).toISOString(),
    });
  }
}

class PrivateUpstreamError extends Error {
  public override readonly name = "PrivateUpstreamError";
}

class ThrowingOperationsPort extends RecordingOperationsPort {
  public override async readVersion(): Promise<never> {
    throw new PrivateUpstreamError(
      "http://worker-00:3000/private?token=must-not-leak",
    );
  }
}

const apps: Array<Awaited<ReturnType<typeof buildManagedApi>>["app"]> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("managed API requested resource identity", () => {
  it("fails closed when detail lookup returns a different resource ID", async () => {
    // Given
    const { app } = await buildManagedApi(
      USER_A,
      new WrongDetailIdentityPort(),
    );
    apps.push(app);

    // When
    const session = await app.inject({
      method: "GET",
      url: `/v1/managed/sessions/${SESSION_A_ID}`,
    });
    const admission = await app.inject({
      method: "GET",
      url: `/v1/managed/admissions/${ADMISSION_A_ID}`,
    });

    // Then
    expect([session.statusCode, admission.statusCode]).toEqual([502, 502]);
    expect(session.json()).toMatchObject({
      error: { code: MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE },
    });
    expect(admission.json()).toMatchObject({
      error: { code: MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE },
    });
  });

  it("fails closed when mutation output returns a different resource ID", async () => {
    // Given
    const { app } = await buildManagedApi(
      USER_A,
      new WrongMutationIdentityPort(),
    );
    apps.push(app);

    // When
    const release = await app.inject({
      method: "POST",
      url: `/v1/managed/sessions/${SESSION_A_ID}/release`,
      payload: {},
    });
    const cancel = await app.inject({
      method: "POST",
      url: `/v1/managed/admissions/${ADMISSION_A_ID}/cancel`,
      payload: {},
    });

    // Then
    expect([release.statusCode, cancel.statusCode]).toEqual([502, 502]);
    expect(release.json()).toMatchObject({
      error: { code: MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE },
    });
    expect(cancel.json()).toMatchObject({
      error: { code: MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE },
    });
  });

  it("binds pool mutation output to the expected manager instance", async () => {
    // Given
    const { app } = await buildManagedApi(OPERATOR);
    apps.push(app);

    // When
    const response = await app.inject({
      method: "POST",
      url: "/v1/managed/pool/drain",
      payload: {
        idempotencyKey: IDEMPOTENCY_KEY,
        expectedManagerInstanceId: ManagerInstanceIdSchema.parse(uuid(301)),
        deadlineAt: new Date(61_000).toISOString(),
        reason: MANAGER_MODE_CAUSE.CUTOVER,
      },
    });

    // Then
    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      error: { code: MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE },
    });
  });

  it("redacts unknown domain failures behind the common managed envelope", async () => {
    // Given
    const { app } = await buildManagedApi(USER_A, new ThrowingOperationsPort());
    apps.push(app);

    // When
    const response = await app.inject({
      method: "GET",
      url: "/v1/managed/version",
    });

    // Then
    expect(response.statusCode).toBe(502);
    expect(response.headers["x-managed-api-version"]).toBe(
      CONTROL_PLANE_API_VERSION,
    );
    expect(response.json()).toMatchObject({
      error: {
        code: MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE,
        message: "Managed operation failed",
      },
    });
    expect(response.body).not.toContain("worker-00");
    expect(response.body).not.toContain("must-not-leak");
  });
});
