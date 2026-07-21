import { z } from "zod"
import {
  ManagedTransportError,
  ManagedWebSocketRouteId,
  PublicSessionIdSchema,
  connectWorker,
  type WorkerDescriptor,
  type WorkerGenerationVerifier,
  type WorkerPrivateIdentity,
} from "@happycastle/steel-managed-gateway"
import {
  MANAGED_ERROR_CODE,
  type Session,
} from "@happycastle/steel-managed-shared"
import type { BrowserPagePort } from "./browser-automation-executor.js"
import { CdpBrowserPage } from "./cdp-browser-page.js"
import { CdpConnection } from "./cdp-connection.js"

const CDP_METHOD = {
  ATTACH_TARGET: "Target.attachToTarget",
  GET_TARGETS: "Target.getTargets",
} as const
const CDP_TARGET_TYPE = { PAGE: "page" } as const

const TargetListSchema = z.object({
  targetInfos: z.array(z.object({
    targetId: z.string().min(1),
    type: z.string().min(1),
  }).passthrough()),
}).passthrough()
const AttachTargetSchema = z.object({ sessionId: z.string().min(1) }).passthrough()

type WorkerCdpPageFactoryOptions = Readonly<{
  commandTimeoutMilliseconds: number
  connectTimeoutMilliseconds: number
  identity: WorkerPrivateIdentity
  messageBytes: number
  resolveWorker(session: Session): WorkerDescriptor
  verifier: WorkerGenerationVerifier
}>

export class WorkerCdpPageFactory {
  public constructor(private readonly options: WorkerCdpPageFactoryOptions) {
    positiveInteger(options.commandTimeoutMilliseconds, "CDP command timeout")
    positiveInteger(options.connectTimeoutMilliseconds, "CDP connect timeout")
    positiveInteger(options.messageBytes, "CDP message capacity")
  }

  public async open(session: Session, signal: AbortSignal): Promise<BrowserPagePort> {
    const worker = this.options.resolveWorker(session)
    await this.options.verifier.assertCurrent(worker, signal)
    const publicSessionId = PublicSessionIdSchema.parse(session.sessionId)
    const handshake = await connectWorker({
      headers: {},
      identity: this.options.identity,
      messageBytes: this.options.messageBytes,
      signal,
      target: {
        routeId: ManagedWebSocketRouteId.CDP,
        sessionId: publicSessionId,
        upstreamPathAndQuery: "/",
        worker,
      },
      timeoutMilliseconds: this.options.connectTimeoutMilliseconds,
    })
    handshake.assertOpen()
    handshake.transferOwnership()
    const connection = new CdpConnection({
      commandTimeoutMilliseconds: this.options.commandTimeoutMilliseconds,
      messageBytes: this.options.messageBytes,
      signal,
      socket: handshake.socket,
    })
    try {
      const listed = TargetListSchema.parse(await connection.send(CDP_METHOD.GET_TARGETS))
      const target = listed.targetInfos.find(({ type }) => type === CDP_TARGET_TYPE.PAGE)
      if (target === undefined) throw noBrowserTarget()
      const attached = AttachTargetSchema.parse(await connection.send(
        CDP_METHOD.ATTACH_TARGET,
        { flatten: true, targetId: target.targetId },
      ))
      await this.options.verifier.assertCurrent(worker, signal)
      return new FencedCdpBrowserPage(
        connection,
        attached.sessionId,
        worker,
        this.options.verifier,
        signal,
      )
    } catch (error) {
      await connection.close()
      throw error
    }
  }
}

class FencedCdpBrowserPage extends CdpBrowserPage {
  public constructor(
    connection: CdpConnection,
    sessionId: string,
    private readonly worker: WorkerDescriptor,
    private readonly verifier: WorkerGenerationVerifier,
    private readonly signal: AbortSignal,
  ) {
    super(connection, sessionId)
  }

  public override async close(): Promise<void> {
    await super.close()
    if (!this.signal.aborted) await this.verifier.assertCurrent(this.worker, this.signal)
  }
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${label} must be positive`)
}

function noBrowserTarget(): ManagedTransportError {
  return new ManagedTransportError(
    MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE,
    "The browser page target was unavailable",
  )
}
