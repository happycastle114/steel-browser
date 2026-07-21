import type {
  Admission,
  AdmissionId,
  EmptyManagedMutationBody,
  ManagedAdmissionCreateRequest,
  OwnedAuthorizationResource,
  Pool,
  PoolDrainRequest,
  PoolResumeRequest,
  PrincipalId,
  PrincipalRole,
  Session,
  SessionId,
  Sha256,
  Version,
  Worker,
} from "@happycastle/steel-managed-shared";
import type { FastifyRequest } from "fastify";

export type ManagedPrincipal = Readonly<{
  principalDigest: Sha256;
  principalId: PrincipalId;
  role: PrincipalRole;
}>;

export type ManagedAdmissionCreateCommand = Readonly<{
  principalId: PrincipalId;
  request: ManagedAdmissionCreateRequest;
}>;

export type ManagedAdmissionMutationCommand = Readonly<{
  admissionId: AdmissionId;
  body: EmptyManagedMutationBody;
  principalId: PrincipalId;
}>;

export type ManagedSessionReleaseCommand = Readonly<{
  body: EmptyManagedMutationBody;
  principalId: PrincipalId;
  sessionId: SessionId;
}>;

export type ManagedPoolDrainCommand = Readonly<{
  principalId: PrincipalId;
  request: PoolDrainRequest;
}>;

export type ManagedPoolResumeCommand = Readonly<{
  principalId: PrincipalId;
  request: PoolResumeRequest;
}>;

export interface ManagedOperationsPort {
  cancelAdmission(command: ManagedAdmissionMutationCommand): Promise<Admission>;
  captureQueue(): Promise<readonly Admission[]>;
  captureSessions(): Promise<readonly OwnedAuthorizationResource<Session>[]>;
  captureWorkers(): Promise<readonly Worker[]>;
  createAdmission(command: ManagedAdmissionCreateCommand): Promise<Admission>;
  drainPool(command: ManagedPoolDrainCommand): Promise<Pool>;
  findAdmission(
    admissionId: AdmissionId,
  ): Promise<OwnedAuthorizationResource<Admission> | undefined>;
  findSession(
    sessionId: SessionId,
  ): Promise<OwnedAuthorizationResource<Session> | undefined>;
  readPool(): Promise<Pool>;
  readVersion(): Promise<Version>;
  releaseSession(command: ManagedSessionReleaseCommand): Promise<Session>;
  resumePool(command: ManagedPoolResumeCommand): Promise<Pool>;
}

export type ManagedPrincipalResolver = (
  request: FastifyRequest,
) => ManagedPrincipal | Promise<ManagedPrincipal>;
