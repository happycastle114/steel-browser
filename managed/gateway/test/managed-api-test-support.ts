import Fastify from "fastify";
import {
  ADMISSION_STATE,
  AdmissionSchema,
  BootIdSchema,
  CONTROL_PLANE_API_VERSION,
  MANAGED_RELEASE_EVIDENCE_MODE,
  MANAGER_MODE,
  MANAGER_MODE_CAUSE,
  SESSION_STATE,
  SessionSchema,
  UuidSchema,
  VersionSchema,
  WORKER_STATE,
  WorkerSchema,
  type Admission,
  type AdmissionId,
  type ControlPlaneConfig,
  type OwnedAuthorizationResource,
  type Pool,
  type Session,
  type SessionId,
  type Version,
  type Worker,
} from "@happycastle/steel-managed-shared";
import {
  ManagedEventJournal,
  ManagedListSnapshotStore,
  PoolMutationCoordinator,
  registerManagedOperationsApi,
  type ManagedAdmissionCreateCommand,
  type ManagedAdmissionMutationCommand,
  type ManagedOperationsPort,
  type ManagedPoolDrainCommand,
  type ManagedPoolResumeCommand,
  type ManagedPrincipal,
  type ManagedSessionReleaseCommand,
} from "../src/api/operations/index.js";
import {
  ADMISSION_A,
  ADMISSION_B,
  ApiClock,
  CONTROL_PLANE_CONFIG,
  SESSION_A,
  SESSION_B,
  USER_A_ID,
  USER_B_ID,
  pool,
  uuid,
} from "./managed-api-fixtures.js";

export * from "./managed-api-fixtures.js";

class OperationsPortFixtureError extends Error {
  public override readonly name = "OperationsPortFixtureError";
}

export class RecordingOperationsPort implements ManagedOperationsPort {
  public captures = 0;
  public currentPool: Pool;
  public mutations = 0;
  public sessions: readonly OwnedAuthorizationResource<Session>[] = [
    { ownerId: USER_A_ID, resource: SESSION_A },
    { ownerId: USER_B_ID, resource: SESSION_B },
  ];
  public admissions: readonly OwnedAuthorizationResource<Admission>[] = [
    { ownerId: USER_A_ID, resource: ADMISSION_A },
    { ownerId: USER_B_ID, resource: ADMISSION_B },
  ];
  public workers: readonly Worker[] = [
    WorkerSchema.parse({
      workerId: "worker-00",
      instanceId: uuid(21),
      state: WORKER_STATE.IDLE,
      lastSeenAt: new Date(1).toISOString(),
      stateChangedAt: new Date(1).toISOString(),
    }),
    WorkerSchema.parse({
      workerId: "worker-01",
      instanceId: uuid(22),
      state: WORKER_STATE.IDLE,
      lastSeenAt: new Date(1).toISOString(),
      stateChangedAt: new Date(1).toISOString(),
    }),
  ];

  public constructor(
    private readonly config: ControlPlaneConfig = CONTROL_PLANE_CONFIG,
  ) {
    this.currentPool = pool(
      MANAGER_MODE.SERVING,
      MANAGER_MODE_CAUSE.RECOVERY,
      config,
    );
  }

  public async cancelAdmission(
    command: ManagedAdmissionMutationCommand,
  ): Promise<Admission> {
    this.mutations += 1;
    return AdmissionSchema.parse({
      ...this.requireAdmission(command.admissionId).resource,
      state: ADMISSION_STATE.CANCELLED,
      updatedAt: new Date(2_000).toISOString(),
    });
  }

  public async captureQueue(): Promise<readonly Admission[]> {
    this.captures += 1;
    return this.admissions.map(({ resource }) => resource);
  }

  public async captureSessions(): Promise<
    readonly OwnedAuthorizationResource<Session>[]
  > {
    this.captures += 1;
    return this.sessions;
  }

  public async captureWorkers(): Promise<readonly Worker[]> {
    this.captures += 1;
    return this.workers;
  }

  public async createAdmission(
    _command: ManagedAdmissionCreateCommand,
  ): Promise<Admission> {
    this.mutations += 1;
    return ADMISSION_A;
  }

  public async drainPool(command: ManagedPoolDrainCommand): Promise<Pool> {
    this.mutations += 1;
    this.currentPool = pool(
      MANAGER_MODE.DRAINING,
      command.request.reason,
      this.config,
    );
    return this.currentPool;
  }

  public async findAdmission(
    admissionId: AdmissionId,
  ): Promise<OwnedAuthorizationResource<Admission> | undefined> {
    return this.admissions.find(
      ({ resource }) => resource.admissionId === admissionId,
    );
  }

  public async findSession(
    sessionId: SessionId,
  ): Promise<OwnedAuthorizationResource<Session> | undefined> {
    return this.sessions.find(
      ({ resource }) => resource.sessionId === sessionId,
    );
  }

  public async readPool(): Promise<Pool> {
    return this.currentPool;
  }

  public async readVersion(): Promise<Version> {
    return VersionSchema.parse({
      apiVersion: CONTROL_PLANE_API_VERSION,
      upstreamSha: "1".repeat(40),
      managedSha: "2".repeat(40),
      managerDigest: `sha256:${"3".repeat(64)}`,
      workerDigest: `sha256:${"4".repeat(64)}`,
      browserVersion: "150.0",
      toolchainLockSha256: "5".repeat(64),
      managerConfigSha256: "6".repeat(64),
      releaseEvidenceSha256: "7".repeat(64),
      releaseEvidenceMode: MANAGED_RELEASE_EVIDENCE_MODE.CONFIG_FILE,
      createTokenKeyId: "8".repeat(16),
      startedAt: new Date(0).toISOString(),
    });
  }

  public async releaseSession(
    command: ManagedSessionReleaseCommand,
  ): Promise<Session> {
    this.mutations += 1;
    const found = await this.findSession(command.sessionId);
    if (found === undefined) {
      throw new OperationsPortFixtureError("missing session fixture");
    }
    return SessionSchema.parse({
      ...found.resource,
      state: SESSION_STATE.RELEASED,
      endedAt: new Date(2_000).toISOString(),
    });
  }

  public async resumePool(_command: ManagedPoolResumeCommand): Promise<Pool> {
    this.mutations += 1;
    this.currentPool = pool(
      MANAGER_MODE.SERVING,
      MANAGER_MODE_CAUSE.RECOVERY,
      this.config,
    );
    return this.currentPool;
  }

  private requireAdmission(admissionId: AdmissionId) {
    const admission = this.admissions.find(
      ({ resource }) => resource.admissionId === admissionId,
    );
    if (admission === undefined) {
      throw new OperationsPortFixtureError("missing admission fixture");
    }
    return admission;
  }
}

export async function buildManagedApi(
  principal: ManagedPrincipal,
  port = new RecordingOperationsPort(),
  config: ControlPlaneConfig = CONTROL_PLANE_CONFIG,
) {
  const clock = new ApiClock();
  const bootId = BootIdSchema.parse(uuid(400));
  let requestSequence = 500;
  const app = Fastify();
  const events = new ManagedEventJournal({ bootId, capacity: 100, clock });
  await registerManagedOperationsApi(app, {
    events,
    nextRequestId: () => UuidSchema.parse(uuid(requestSequence++)),
    port,
    poolMutations: new PoolMutationCoordinator({
      clock,
      config,
    }),
    resolvePrincipal: () => principal,
    snapshots: new ManagedListSnapshotStore({
      bootId,
      clock,
      maxBytes: 33_554_432,
      maxSnapshots: 100,
      ttlMs: 30_000,
    }),
  });
  await app.ready();
  return { app, events, port };
}
