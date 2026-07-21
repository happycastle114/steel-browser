import { ManagedCreateHeaderValuesSchema } from "@happycastle/steel-managed-shared"
import {
  WorkerIdentityMismatchError,
  WorkerMutationNotStartedError,
  WorkerProtocolError,
  WorkerTransportError,
} from "../domain/errors.js"
import {
  UpstreamSessionIdSchema,
  type UpstreamSessionId,
} from "../domain/ids.js"
import { WorkerMutation, WorkerTransportReason } from "../domain/states.js"
import type { StaticWorkerEndpoint } from "./static-worker-provider.js"
import { BoundedJsonClient, type BoundedJsonClientOptions } from "./bounded-json-client.js"
import {
  UpstreamCreateRequestSchema,
  UpstreamReleaseResponseSchema,
  UpstreamSessionResponseSchema,
  UpstreamSessionState,
  UpstreamWorkerPath,
  type WorkerCreateCommand,
  type WorkerCreateResult,
  type WorkerHttpClient,
  type WorkerListResult,
  type WorkerProbe,
} from "./worker-http-contract.js"
import { WorkerSupervisorReader } from "./worker-supervisor-reader.js"

const HTTP_METHOD = { POST: "POST" } as const
export class WorkerHttpAdapter implements WorkerHttpClient {
  private readonly client: BoundedJsonClient
  private readonly supervisor: WorkerSupervisorReader

  public constructor(input: BoundedJsonClientOptions) {
    this.client = new BoundedJsonClient(input)
    this.supervisor = new WorkerSupervisorReader(this.client)
  }

  public async probe(endpoint: StaticWorkerEndpoint, signal: AbortSignal): Promise<WorkerProbe> {
    const worker = await this.supervisor.readMetadata(endpoint, signal)
    const listed = await this.supervisor.readActiveCreates(worker, signal)
    await this.assertCurrent(worker, signal)
    return listed
  }

  public async list(
    worker: WorkerProbe["worker"],
    signal: AbortSignal,
  ): Promise<WorkerListResult> {
    await this.assertCurrent(worker, signal)
    const listed = await this.supervisor.readActiveCreates(worker, signal)
    await this.assertCurrent(worker, signal)
    return listed
  }

  public async create(
    worker: WorkerProbe["worker"],
    command: WorkerCreateCommand,
    signal: AbortSignal,
  ): Promise<WorkerCreateResult> {
    await this.requireMutationPreflight(worker, signal, WorkerMutation.CREATE)
    const wireRequest = UpstreamCreateRequestSchema.parse({ sessionId: command.publicSessionId })
    const headers = command.managedCreate === undefined
      ? undefined
      : ManagedCreateHeaderValuesSchema.parse(command.managedCreate)
    const response = await this.client.send({
      workerId: worker.workerId,
      identity: worker,
      url: new URL(UpstreamWorkerPath.SESSIONS, worker.origin),
      method: HTTP_METHOD.POST,
      schema: UpstreamSessionResponseSchema,
      signal,
      body: JSON.stringify(wireRequest),
      ...(headers === undefined ? {} : { headers }),
    })
    if (
      response.body.status !== UpstreamSessionState.LIVE ||
      response.body.id !== command.publicSessionId
    ) {
      throw new WorkerProtocolError(worker.workerId, "upstream create response mismatched")
    }
    this.supervisor.requireResponseIdentity(response.headers, worker)
    await this.assertCurrent(worker, signal)
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
      identity: worker,
      url: new URL(
        `${UpstreamWorkerPath.SESSIONS}/${encodeURIComponent(upstreamSessionId)}/release`,
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
    this.supervisor.requireResponseIdentity(response.headers, worker)
    await this.assertCurrent(worker, signal)
  }

  public async close(): Promise<void> {
    await this.client.close()
  }

  public async assertCurrent(
    worker: WorkerProbe["worker"],
    signal: AbortSignal,
  ): Promise<void> {
    const current = await this.supervisor.readMetadata(worker, signal)
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
      await this.assertCurrent(worker, signal)
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
}
