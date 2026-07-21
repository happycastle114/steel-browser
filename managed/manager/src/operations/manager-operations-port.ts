import {
  type ManagedAdmissionCreateCommand,
  type ManagedAdmissionMutationCommand,
  type ManagedOperationsPort as ManagedOperationsContract,
  type ManagedPoolDrainCommand,
  type ManagedPoolResumeCommand,
  type ManagedSessionReleaseCommand,
  type WorkerRecord,
} from "@happycastle/steel-managed-gateway"
import {
  VersionSchema,
  type Admission,
  type AdmissionId,
  type OwnedAuthorizationResource,
  type Pool,
  type Session,
  type SessionId,
  type Version,
  type Worker,
} from "@happycastle/steel-managed-shared"
import { projectWorkerRecord } from "./resource-projection.js"

type AdmissionOperations = Pick<
  ManagedOperationsContract,
  | "cancelAdmission"
  | "captureQueue"
  | "captureSessions"
  | "createAdmission"
  | "findAdmission"
  | "findSession"
  | "releaseSession"
> & Readonly<{ shutdown(): void }>

type PoolOperations = Pick<
  ManagedOperationsContract,
  "drainPool" | "readPool" | "resumePool"
> & Readonly<{
  markMutation(): void
  requireServing(): void
}>

type ManagerOperationsPortOptions = Readonly<{
  admissions: AdmissionOperations
  pool: PoolOperations
  version: Version
  workers(): readonly WorkerRecord[]
}>

export class ManagerOperationsPort implements ManagedOperationsContract {
  readonly #version: Version

  public constructor(private readonly options: ManagerOperationsPortOptions) {
    this.#version = VersionSchema.parse(options.version)
  }

  public async cancelAdmission(command: ManagedAdmissionMutationCommand): Promise<Admission> {
    this.options.pool.markMutation()
    return this.options.admissions.cancelAdmission(command)
  }

  public async captureQueue(): Promise<readonly Admission[]> {
    return this.options.admissions.captureQueue()
  }

  public async captureSessions(): Promise<readonly OwnedAuthorizationResource<Session>[]> {
    return this.options.admissions.captureSessions()
  }

  public async captureWorkers(): Promise<readonly Worker[]> {
    return this.options.workers().map(projectWorkerRecord)
  }

  public async createAdmission(command: ManagedAdmissionCreateCommand): Promise<Admission> {
    this.options.pool.requireServing()
    this.options.pool.markMutation()
    return this.options.admissions.createAdmission(command)
  }

  public async drainPool(command: ManagedPoolDrainCommand): Promise<Pool> {
    const pool = await this.options.pool.drainPool(command)
    this.options.admissions.shutdown()
    return pool
  }

  public async findAdmission(
    admissionId: AdmissionId,
  ): Promise<OwnedAuthorizationResource<Admission> | undefined> {
    return this.options.admissions.findAdmission(admissionId)
  }

  public async findSession(
    sessionId: SessionId,
  ): Promise<OwnedAuthorizationResource<Session> | undefined> {
    return this.options.admissions.findSession(sessionId)
  }

  public async readPool(): Promise<Pool> {
    return this.options.pool.readPool()
  }

  public async readVersion(): Promise<Version> {
    return this.#version
  }

  public async releaseSession(command: ManagedSessionReleaseCommand): Promise<Session> {
    this.options.pool.markMutation()
    return this.options.admissions.releaseSession(command)
  }

  public async resumePool(command: ManagedPoolResumeCommand): Promise<Pool> {
    return this.options.pool.resumePool(command)
  }
}
