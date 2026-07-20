import {
  WorkerIdentityMismatchError,
  WorkerMutationNotStartedError,
  WorkerProtocolError,
  WorkerTransportError,
} from "../domain/errors.js"
import { assertNever } from "../domain/exhaustive.js"
import {
  AllocationIdSchema,
  UpstreamSessionIdSchema,
  type PublicSessionId,
  type UpstreamSessionId,
} from "../domain/ids.js"
import {
  WorkerMutation,
  WorkerRemoteState,
  WorkerTransportReason,
} from "../domain/states.js"
import {
  WorkerDescriptorSchema,
  type RecoverableSession,
  type WorkerDescriptor,
} from "../registry/registry-model.js"
import type { StaticWorkerEndpoint } from "./static-worker-provider.js"
import { BoundedJsonClient, type BoundedJsonClientOptions } from "./bounded-json-client.js"
import {
  UpstreamCreateRequestSchema,
  UpstreamReleaseResponseSchema,
  UpstreamSessionResponseSchema,
  UpstreamSessionState,
  WorkerBootStatus,
  WorkerActiveSessionResponseSchema,
  WorkerHeader,
  WorkerMetaResponseSchema,
  WorkerPath,
  type WorkerCreateCommand,
  type WorkerCreateResult,
  type WorkerHttpClient,
  type WorkerListResult,
  type WorkerProbe,
} from "./worker-http-contract.js"

const HTTP_METHOD = { GET: "GET", POST: "POST" } as const
type WireIdentity = Pick<WorkerDescriptor, "workerId" | "instanceId">
export class WorkerHttpAdapter implements WorkerHttpClient {
  private readonly client: BoundedJsonClient

  public constructor(input: BoundedJsonClientOptions) {
    this.client = new BoundedJsonClient(input)
  }

  public async probe(endpoint: StaticWorkerEndpoint, signal: AbortSignal): Promise<WorkerProbe> {
    const worker = await this.readMetadata(endpoint, signal)
    const listed = await this.readActiveSession(worker, signal)
    await this.requireCurrent(worker, signal)
    return listed
  }

  public async list(
    worker: WorkerProbe["worker"],
    signal: AbortSignal,
  ): Promise<WorkerListResult> {
    await this.requireCurrent(worker, signal)
    const listed = await this.readActiveSession(worker, signal)
    await this.requireCurrent(worker, signal)
    return listed
  }

  public async create(
    worker: WorkerProbe["worker"],
    command: WorkerCreateCommand,
    signal: AbortSignal,
  ): Promise<WorkerCreateResult> {
    await this.requireMutationPreflight(worker, signal, WorkerMutation.CREATE)
    const wireRequest = UpstreamCreateRequestSchema.parse({ sessionId: command.publicSessionId })
    const response = await this.client.send({
      workerId: worker.workerId,
      url: new URL(WorkerPath.SESSIONS, worker.origin),
      method: HTTP_METHOD.POST,
      schema: UpstreamSessionResponseSchema,
      signal,
      body: JSON.stringify(wireRequest),
    })
    if (
      response.body.status !== UpstreamSessionState.LIVE ||
      response.body.id !== command.publicSessionId
    ) {
      throw new WorkerProtocolError(worker.workerId, "upstream create response mismatched")
    }
    this.requireResponseIdentity(response.headers, worker)
    await this.requireCurrent(worker, signal)
    return {
      worker,
      upstreamSessionId: UpstreamSessionIdSchema.parse(response.body.id),
    }
  }

  public async release(
    worker: WorkerProbe["worker"],
    upstreamSessionId: UpstreamSessionId,
    signal: AbortSignal,
  ): Promise<void> {
    await this.requireMutationPreflight(worker, signal, WorkerMutation.RELEASE)
    const response = await this.client.send({
      workerId: worker.workerId,
      url: new URL(
        `${WorkerPath.SESSIONS}/${encodeURIComponent(upstreamSessionId)}/release`,
        worker.origin,
      ),
      method: HTTP_METHOD.POST,
      schema: UpstreamReleaseResponseSchema,
      signal,
    })
    if (
      response.body.status !== UpstreamSessionState.RELEASED ||
      response.body.id !== upstreamSessionId
    ) {
      throw new WorkerProtocolError(worker.workerId, "upstream release response mismatched")
    }
    this.requireResponseIdentity(response.headers, worker)
    await this.requireCurrent(worker, signal)
  }

  public async close(): Promise<void> {
    await this.client.close()
  }

  private async readMetadata(
    endpoint: StaticWorkerEndpoint,
    signal: AbortSignal,
  ): Promise<WorkerProbe["worker"]> {
    const response = await this.client.send({
      workerId: endpoint.workerId,
      url: new URL(WorkerPath.META, endpoint.origin),
      method: HTTP_METHOD.GET,
      schema: WorkerMetaResponseSchema,
      signal,
    })
    const metadata = response.body
    this.requireWireIdentity(metadata, response.headers, endpoint.workerId)
    switch (metadata.status) {
      case WorkerBootStatus.READY:
        return WorkerDescriptorSchema.parse({
          workerId: metadata.workerId,
          instanceId: metadata.instanceId,
          origin: endpoint.origin,
        })
      case WorkerBootStatus.BOOTSTRAPPING:
        throw new WorkerProtocolError(endpoint.workerId, "worker is still bootstrapping")
      default:
        return assertNever(metadata.status)
    }
  }

  private async requireCurrent(
    worker: WorkerProbe["worker"],
    signal: AbortSignal,
  ): Promise<void> {
    const current = await this.readMetadata(worker, signal)
    if (current.instanceId !== worker.instanceId) {
      throw new WorkerIdentityMismatchError(worker.workerId, current.instanceId)
    }
  }

  private async requireMutationPreflight(
    worker: WorkerProbe["worker"],
    signal: AbortSignal,
    mutation: WorkerMutation,
  ): Promise<void> {
    try {
      await this.requireCurrent(worker, signal)
    } catch (error) {
      if (
        signal.aborted &&
        error instanceof WorkerTransportError &&
        error.reason === WorkerTransportReason.ABORTED
      ) {
        throw new WorkerMutationNotStartedError(worker.workerId, mutation, { cause: error })
      }
      throw error
    }
    if (signal.aborted) throw new WorkerMutationNotStartedError(worker.workerId, mutation)
  }

  private async readActiveSession(
    worker: WorkerProbe["worker"],
    signal: AbortSignal,
  ): Promise<WorkerListResult> {
    const response = await this.client.send({
      workerId: worker.workerId,
      url: new URL(WorkerPath.ACTIVE_SESSION, worker.origin),
      method: HTTP_METHOD.GET,
      schema: WorkerActiveSessionResponseSchema,
      signal,
    })
    this.requireWireIdentity(response.body, response.headers, worker.workerId, worker.instanceId)
    const sessions =
      response.body.activeSession === null
        ? []
        : [this.recoverableSession(response.body.activeSession.id)]
    return {
      worker,
      remoteState: sessions.length === 0 ? WorkerRemoteState.IDLE : WorkerRemoteState.BUSY,
      sessions,
    }
  }

  private requireWireIdentity(
    body: WireIdentity,
    headers: Readonly<Record<string, string | readonly string[] | undefined>>,
    expectedWorkerId: WorkerProbe["worker"]["workerId"],
    expectedInstanceId?: WorkerProbe["worker"]["instanceId"],
  ): void {
    if (body.workerId !== expectedWorkerId) {
      throw new WorkerIdentityMismatchError(expectedWorkerId, body.instanceId)
    }
    if (expectedInstanceId !== undefined && body.instanceId !== expectedInstanceId) {
      throw new WorkerIdentityMismatchError(expectedWorkerId, body.instanceId)
    }
    this.requireResponseIdentity(headers, body)
  }

  private requireResponseIdentity(
    headers: Readonly<Record<string, string | readonly string[] | undefined>>,
    expected: WireIdentity,
  ): void {
    if (
      headers[WorkerHeader.WORKER_ID] !== expected.workerId ||
      headers[WorkerHeader.INSTANCE_ID] !== expected.instanceId
    ) {
      throw new WorkerIdentityMismatchError(expected.workerId, expected.instanceId)
    }
  }

  private recoverableSession(publicSessionId: PublicSessionId): RecoverableSession {
    return {
      allocationId: AllocationIdSchema.parse(`allocation-recovered-${publicSessionId}`),
      publicSessionId,
      upstreamSessionId: UpstreamSessionIdSchema.parse(publicSessionId),
    }
  }

}
