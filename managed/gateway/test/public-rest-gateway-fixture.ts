import { createServer, type Server, type ServerResponse } from "node:http"
import {
  AccessAuthenticationError,
  AllocationIdSchema,
  EventLedger,
  InstanceIdSchema,
  PublicHttpMethod,
  PublicRequestSecurity,
  PublicRestGateway,
  SessionState,
  UpstreamSessionIdSchema,
  WorkerDescriptorSchema,
  WorkerIdSchema,
  WorkerIdentityMismatchError,
  WorkerRegistry,
  WorkerRemoteState,
  WorkerRestProxy,
  type CompatibilityLifecycleRequest,
  type CompatibilityLifecycleResult,
  type CompatibilitySessionLifecycle,
  type PublicSessionId,
  type WorkerDescriptor,
  type WorkerGenerationVerifier,
} from "../src/index.js"
import { FakeClock, publicSessionId } from "./test-support.js"

const MANAGER_INSTANCE_ID = "11111111-2222-4333-8444-555555555555"
export const PUBLIC_HOST = "public.steel.example"
export const PUBLIC_ORIGIN = `https://${PUBLIC_HOST}`

export class CompatibilityWorkerFake {
  private readonly server: Server
  private sessionIds: readonly PublicSessionId[] = []
  private readonly streams = new Set<ServerResponse>()
  private readonly statusByPath = new Map<string, number>()
  public readonly requests: string[] = []
  public origin = ""

  public constructor(public readonly sequence: number) {
    this.server = createServer((request, response) => {
      const path = request.url ?? ""
      this.requests.push(`${request.method ?? ""} ${path}`)
      const statusCode = this.statusByPath.get(path)
      if (statusCode !== undefined) {
        response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" })
        response.end(JSON.stringify({ additive: `worker-${this.sequence}`, statusCode }))
        return
      }
      if (request.method === PublicHttpMethod.HEAD && path.includes("/files/")) {
        response.writeHead(200, { "content-length": "1234", "content-type": "text/plain" })
        response.end()
        return
      }
      if (
        (request.method === PublicHttpMethod.GET || request.method === PublicHttpMethod.HEAD) &&
        path === "/v1/sessions"
      ) {
        const body = Buffer.from(JSON.stringify({
          sessions: this.sessionIds.map((sessionId) => this.sessionBody(sessionId)),
          additive: `worker-${this.sequence}`,
        }))
        response.setHeader("content-length", String(body.byteLength))
        response.setHeader("content-type", "application/json; charset=utf-8")
        response.end(request.method === PublicHttpMethod.HEAD ? undefined : body)
        return
      }
      if (request.method === PublicHttpMethod.GET && path === "/v1/logs/stream") {
        this.streams.add(response)
        response.once("close", () => this.streams.delete(response))
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "set-cookie": "private-worker=secret",
          "www-authenticate": "Bearer private-worker",
          "x-managed-private": "remove-me",
          "x-worker-location": this.origin.toUpperCase(),
        })
        response.write(": connected\n\n")
        return
      }
      if (request.method === PublicHttpMethod.GET && path.endsWith("/context")) {
        response.setHeader("content-type", "application/json; charset=utf-8")
        response.end(JSON.stringify({ worker: this.sequence }))
        return
      }
      response.setHeader("content-type", "application/json; charset=utf-8")
      response.end(JSON.stringify({ worker: this.sequence, path }))
    })
  }

  public async listen(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve))
    const address = this.server.address()
    if (address === null || typeof address === "string") throw new TypeError("expected TCP address")
    this.origin = `http://127.0.0.1:${address.port}`
  }

  public setSession(sessionId: PublicSessionId | undefined): void {
    this.sessionIds = sessionId === undefined ? [] : [sessionId]
  }

  public setSessions(sessionIds: readonly PublicSessionId[]): void {
    this.sessionIds = sessionIds
  }

  public respondWith(path: string, statusCode: number): void {
    this.statusByPath.set(path, statusCode)
  }

  public async close(): Promise<void> {
    for (const response of this.streams) response.destroy()
    this.server.closeAllConnections()
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }

  public sessionBody(sessionId: PublicSessionId): Readonly<Record<string, unknown>> {
    return {
      id: sessionId,
      status: "live",
      websocketUrl: `${this.origin.replace("http:", "ws:")}/`,
      debugUrl: `${this.origin}/v1/sessions/debug`,
      sessionViewerUrl: `${this.origin}/ui`,
      additive: `worker-${this.sequence}`,
    }
  }
}

class RegistryVerifier implements WorkerGenerationVerifier {
  public constructor(private readonly registry: WorkerRegistry) {}

  public async assertCurrent(worker: WorkerDescriptor): Promise<void> {
    const current = this.registry.workers().find(({ workerId }) => workerId === worker.workerId)
    if (current?.instanceId !== worker.instanceId) {
      throw new WorkerIdentityMismatchError(worker.workerId, worker.instanceId)
    }
  }
}

export class StatefulCompatibilityLifecycle implements CompatibilitySessionLifecycle {
  public createCalls = 0
  public releaseCalls = 0

  public constructor(
    private readonly registry: WorkerRegistry,
    private readonly workers: ReadonlyMap<string, CompatibilityWorkerFake>,
  ) {}

  public async create(_request: CompatibilityLifecycleRequest): Promise<CompatibilityLifecycleResult> {
    this.createCalls += 1
    const sessionId = publicSessionId(this.createCalls)
    const allocationId = AllocationIdSchema.parse(`allocation-public-${this.createCalls}`)
    const worker = this.registry.reserveNext(allocationId)
    if (worker === undefined) throw new TypeError("expected an idle compatibility worker")
    const session = this.registry.bindSession({
      allocationId,
      publicSessionId: sessionId,
      upstreamSessionId: UpstreamSessionIdSchema.parse(sessionId),
    })
    const fake = this.workers.get(worker.origin)
    if (fake === undefined) throw new TypeError("expected a compatibility worker fake")
    fake.setSession(sessionId)
    return {
      session,
      response: {
        statusCode: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: Buffer.from(JSON.stringify(fake.sessionBody(sessionId))),
      },
    }
  }

  public async release(
    sessionId: PublicSessionId,
    _request: CompatibilityLifecycleRequest,
  ): Promise<CompatibilityLifecycleResult> {
    this.releaseCalls += 1
    const releasing = this.registry.beginRelease(sessionId)
    const worker = this.registry.workerForSession(sessionId)
    const released = this.registry.reconcileReleased(sessionId, worker)
    const fake = this.workers.get(worker.origin)
    if (fake === undefined) throw new TypeError("expected a compatibility worker fake")
    fake.setSession(undefined)
    return {
      session: released,
      response: {
        statusCode: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: Buffer.from(JSON.stringify({
          ...fake.sessionBody(releasing.publicSessionId),
          status: SessionState.RELEASED,
        })),
      },
    }
  }
}

export type PublicRestFixture = {
  readonly gateway: PublicRestGateway
  readonly lifecycle: StatefulCompatibilityLifecycle
  readonly registry: WorkerRegistry
  readonly workers: readonly [CompatibilityWorkerFake, CompatibilityWorkerFake]
}

const openFixtures: PublicRestFixture[] = []

export async function createPublicRestFixture(): Promise<PublicRestFixture> {
  const workers = [new CompatibilityWorkerFake(0), new CompatibilityWorkerFake(1)] as const
  await Promise.all(workers.map(async (worker) => worker.listen()))
  const clock = new FakeClock()
  const registry = new WorkerRegistry({ clock, ledger: new EventLedger({ clock }) })
  for (const worker of workers) {
    const descriptor = WorkerDescriptorSchema.parse({
      workerId: WorkerIdSchema.parse(`worker-0${worker.sequence}`),
      instanceId: InstanceIdSchema.parse(
        `00000000-0000-4000-8000-${(worker.sequence + 1).toString().padStart(12, "0")}`,
      ),
      origin: worker.origin,
    })
    registry.commitObservation(registry.beginObservation(descriptor.workerId), {
      worker: descriptor,
      remoteState: WorkerRemoteState.IDLE,
      sessions: [],
    })
  }
  const lifecycle = new StatefulCompatibilityLifecycle(
    registry,
    new Map(workers.map((worker) => [worker.origin, worker])),
  )
  const proxy = new WorkerRestProxy({
    identity: { managerInstanceId: MANAGER_INSTANCE_ID, poolId: "blue" },
    maxRequestBytes: 1024,
    maxResponseBytes: 16_384,
    timeoutMilliseconds: 1000,
    verifier: new RegistryVerifier(registry),
  })
  const security = new PublicRequestSecurity({
    allowedOrigins: [],
    originByHost: { [PUBLIC_HOST]: PUBLIC_ORIGIN },
    authenticate: async (headers) => {
      if (headers["authorization"] !== "Bearer accepted") {
        throw new AccessAuthenticationError("authentication failed")
      }
    },
  })
  const fixture = {
    gateway: new PublicRestGateway({ lifecycle, maxRequestBytes: 1024, proxy, registry, security }),
    lifecycle,
    registry,
    workers,
  }
  openFixtures.push(fixture)
  return fixture
}

export async function closePublicRestFixtures(): Promise<void> {
  await Promise.all(openFixtures.splice(0).map(async ({ gateway, workers }) => {
    await gateway.close()
    await Promise.all(workers.map(async (worker) => worker.close()))
  }))
}

export function publicRequest(
  method: PublicHttpMethod,
  pathAndQuery: string,
  body?: Buffer,
): Parameters<PublicRestGateway["handle"]>[0] {
  return {
    ...(body === undefined ? {} : { body }),
    headers: {
      authorization: "Bearer accepted",
      host: PUBLIC_HOST,
      "content-type": "application/json; charset=utf-8",
    },
    method,
    pathAndQuery,
    requestId: "request-public-rest",
    signal: new AbortController().signal,
  }
}

export function parsedBody(response: Awaited<ReturnType<PublicRestGateway["handle"]>>): unknown {
  return JSON.parse(response.body.toString("utf8"))
}
