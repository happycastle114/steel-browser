import {
  ActiveCreateEnumerationSchema,
  CREATE_JOURNAL_STATE,
  PRIVATE_SUPERVISOR_ROUTE_ID,
  WorkerMetadataSchema,
  type WorkerMetadata,
} from "@happycastle/steel-managed-shared"
import { WorkerIdentityMismatchError, WorkerProtocolError } from "../domain/errors.js"
import {
  AllocationIdSchema,
  PublicSessionIdSchema,
  UpstreamSessionIdSchema,
  type PublicSessionId,
} from "../domain/ids.js"
import { WorkerRemoteState } from "../domain/states.js"
import {
  WorkerDescriptorSchema,
  type RecoverableSession,
  type WorkerDescriptor,
} from "../registry/registry-model.js"
import { assertWorkerIdentityHeaders, BoundedJsonClient } from "./bounded-json-client.js"
import type { StaticWorkerEndpoint } from "./static-worker-provider.js"
import {
  requirePrivateSupervisorRoute,
  type WorkerListResult,
} from "./worker-http-contract.js"

type WireIdentity = Pick<WorkerDescriptor, "workerId" | "instanceId">
type WorkerLocation = StaticWorkerEndpoint | WorkerDescriptor
const METADATA_ROUTE = requirePrivateSupervisorRoute(PRIVATE_SUPERVISOR_ROUTE_ID.META)
const ACTIVE_CREATES_ROUTE = requirePrivateSupervisorRoute(
  PRIVATE_SUPERVISOR_ROUTE_ID.CREATES_ACTIVE,
)

export class WorkerSupervisorReader {
  public constructor(private readonly client: BoundedJsonClient) {}

  public async readMetadata(
    endpoint: WorkerLocation,
    signal: AbortSignal,
  ): Promise<WorkerDescriptor> {
    const response = await this.client.send({
      workerId: endpoint.workerId,
      identity: { workerId: endpoint.workerId },
      url: new URL(METADATA_ROUTE.path, endpoint.origin),
      method: METADATA_ROUTE.method,
      schema: WorkerMetadataSchema,
      signal,
      maxResponseBytes: METADATA_ROUTE.maxResponseBodyBytes,
      validateErrorResponse: (body, headers) => {
        const parsed = WorkerMetadataSchema.safeParse(body)
        if (!parsed.success) {
          throw new WorkerProtocolError(endpoint.workerId, "worker metadata response mismatched", {
            cause: parsed.error,
          })
        }
        this.bindMetadata(parsed.data, headers, endpoint)
      },
    })
    return this.bindMetadata(response.body, response.headers, endpoint)
  }

  public async readActiveCreates(
    worker: WorkerDescriptor,
    signal: AbortSignal,
  ): Promise<WorkerListResult> {
    const response = await this.client.send({
      workerId: worker.workerId,
      identity: worker,
      url: new URL(ACTIVE_CREATES_ROUTE.path, worker.origin),
      method: ACTIVE_CREATES_ROUTE.method,
      schema: ActiveCreateEnumerationSchema,
      signal,
      maxResponseBytes: ACTIVE_CREATES_ROUTE.maxResponseBodyBytes,
    })
    this.requireResponseIdentity(response.headers, worker)
    const active = response.body.creates[0]
    const sessions = active?.state === CREATE_JOURNAL_STATE.LIVE
      ? [this.recoverableSession(worker, active.upstreamSessionId)]
      : []
    return {
      worker,
      remoteState: active === undefined ? WorkerRemoteState.IDLE : WorkerRemoteState.BUSY,
      sessions,
    }
  }

  public requireResponseIdentity(
    headers: Readonly<Record<string, string | readonly string[] | undefined>>,
    expected: WireIdentity,
  ): void {
    assertWorkerIdentityHeaders(headers, expected)
  }

  private bindMetadata(
    body: WorkerMetadata,
    headers: Readonly<Record<string, string | readonly string[] | undefined>>,
    endpoint: WorkerLocation,
  ): WorkerDescriptor {
    if (body.workerId !== endpoint.workerId) {
      throw new WorkerIdentityMismatchError(endpoint.workerId, body.instanceId)
    }
    const worker = WorkerDescriptorSchema.parse({
      workerId: body.workerId,
      instanceId: body.instanceId,
      origin: endpoint.origin,
    })
    this.requireResponseIdentity(headers, worker)
    return worker
  }

  private recoverableSession(
    worker: WorkerDescriptor,
    upstreamSessionId: string,
  ): RecoverableSession {
    const parsed = PublicSessionIdSchema.safeParse(upstreamSessionId)
    if (!parsed.success) {
      throw new WorkerProtocolError(worker.workerId, "active create session id mismatched", {
        cause: parsed.error,
      })
    }
    const publicSessionId: PublicSessionId = parsed.data
    return {
      allocationId: AllocationIdSchema.parse(`allocation-recovered-${publicSessionId}`),
      publicSessionId,
      upstreamSessionId: UpstreamSessionIdSchema.parse(publicSessionId),
    }
  }
}
