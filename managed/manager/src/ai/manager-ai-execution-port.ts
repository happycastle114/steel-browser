import {
  ManagedListSnapshotStore,
  type ControlPlaneExecutionPort,
  type ManagedExecutionCompletion,
  type ManagedExecutionInvocation,
  type ManagedOperationsPort,
} from "@happycastle/steel-managed-gateway"
import {
  EmptyManagedMutationBodySchema,
  JsonValueSchema,
  MANAGED_ADMISSION_OPERATION,
  RESULT_KIND,
  AdmissionStatusToolInputSchema,
  SessionCreateToolInputSchema,
  SessionGetToolInputSchema,
  TOOL_NAME,
  buildLiveViewUrls,
  buildSessionUrls,
  type AiActionRequest,
  type Session,
} from "@happycastle/steel-managed-shared"
import { AUTHORIZATION_OPERATION } from "@happycastle/steel-managed-shared"
import { AiResourceAccess } from "./ai-resource-access.js"

export type BrowserAutomationResult = Readonly<{
  binaryBytes?: Uint8Array
  output: unknown
}>

export interface BrowserAutomationPort {
  execute(
    action: AiActionRequest,
    session: Session,
    signal: AbortSignal,
  ): Promise<BrowserAutomationResult>
}

type ManagerAiExecutionPortOptions = Readonly<{
  browser: BrowserAutomationPort
  clock: Readonly<{ now(): number }>
  operations: Pick<
    ManagedOperationsPort,
    | "cancelAdmission"
    | "captureSessions"
    | "createAdmission"
    | "findAdmission"
    | "findSession"
    | "releaseSession"
  >
  sessionSnapshots: ManagedListSnapshotStore
}>

export class ManagerAiExecutionPort implements ControlPlaneExecutionPort {
  readonly #access: AiResourceAccess

  public constructor(private readonly options: ManagerAiExecutionPortOptions) {
    this.#access = new AiResourceAccess(options)
  }

  public async execute(
    invocation: ManagedExecutionInvocation,
  ): Promise<ManagedExecutionCompletion> {
    const result = await this.dispatch(invocation)
    return {
      resultId: invocation.resultId,
      action: invocation.action,
      ownerId: result.ownerId,
      completedAtMs: this.now(),
      output: JsonValueSchema.parse(result.output),
      ...(result.binaryBytes === undefined
        ? {}
        : { binaryBytes: result.binaryBytes }),
    }
  }

  private async dispatch(invocation: ManagedExecutionInvocation): Promise<{
    binaryBytes?: Uint8Array
    output: unknown
    ownerId: ManagedExecutionCompletion["ownerId"]
  }> {
    const action = invocation.action
    switch (action.tool.name) {
      case TOOL_NAME.SESSION_CREATE: {
        const arguments_ = SessionCreateToolInputSchema.parse(action.arguments)
        const admission = await this.options.operations.createAdmission({
          principalId: invocation.principal.principalId,
          request: {
            idempotencyKey: arguments_.idempotencyKey,
            operation: MANAGED_ADMISSION_OPERATION.SESSION_CREATE,
          },
        })
        if (admission.sessionId === undefined) {
          return {
            ownerId: invocation.principal.principalId,
            output: { kind: RESULT_KIND.ADMISSION, admission },
          }
        }
        const owned = await this.#access.requireSession(
          invocation,
          admission.sessionId,
          AUTHORIZATION_OPERATION.SESSION_DETAIL,
        )
        return {
          ownerId: owned.ownerId,
          output: {
            kind: RESULT_KIND.SESSION,
            session: owned.resource,
            urls: buildSessionUrls(invocation.selectedOrigin, owned.resource.sessionId),
          },
        }
      }
      case TOOL_NAME.SESSION_LIST:
        return {
          ownerId: invocation.principal.principalId,
          output: await this.#access.listSessions(invocation),
        }
      case TOOL_NAME.SESSION_GET: {
        const arguments_ = SessionGetToolInputSchema.parse(action.arguments)
        const owned = await this.#access.requireSession(
          invocation,
          arguments_.sessionId,
          AUTHORIZATION_OPERATION.SESSION_DETAIL,
        )
        return {
          ownerId: owned.ownerId,
          output: {
            kind: RESULT_KIND.SESSION,
            session: owned.resource,
            urls: buildSessionUrls(invocation.selectedOrigin, owned.resource.sessionId),
          },
        }
      }
      case TOOL_NAME.SESSION_RELEASE: {
        const arguments_ = SessionGetToolInputSchema.parse(action.arguments)
        const owned = await this.#access.requireSession(
          invocation,
          arguments_.sessionId,
          AUTHORIZATION_OPERATION.SESSION_RELEASE,
        )
        return {
          ownerId: owned.ownerId,
          output: await this.options.operations.releaseSession({
            body: EmptyManagedMutationBodySchema.parse({}),
            principalId: invocation.principal.principalId,
            sessionId: arguments_.sessionId,
          }),
        }
      }
      case TOOL_NAME.ADMISSION_STATUS: {
        const arguments_ = AdmissionStatusToolInputSchema.parse(action.arguments)
        const owned = await this.#access.requireAdmission(invocation, arguments_.admissionId)
        return { ownerId: owned.ownerId, output: owned.resource }
      }
      case TOOL_NAME.ADMISSION_CANCEL: {
        const arguments_ = AdmissionStatusToolInputSchema.parse(action.arguments)
        const owned = await this.#access.requireAdmission(invocation, arguments_.admissionId)
        return {
          ownerId: owned.ownerId,
          output: await this.options.operations.cancelAdmission({
            admissionId: arguments_.admissionId,
            body: EmptyManagedMutationBodySchema.parse({}),
            principalId: invocation.principal.principalId,
          }),
        }
      }
      case TOOL_NAME.BROWSER_LIVE_VIEW: {
        const arguments_ = SessionGetToolInputSchema.parse(action.arguments)
        const owned = await this.#access.requireSession(
          invocation,
          arguments_.sessionId,
          AUTHORIZATION_OPERATION.SESSION_ACTION,
        )
        return {
          ownerId: owned.ownerId,
          output: {
            kind: RESULT_KIND.LIVE_VIEW,
            sessionId: owned.resource.sessionId,
            ...buildLiveViewUrls(invocation.selectedOrigin, owned.resource.sessionId),
          },
        }
      }
      case TOOL_NAME.BROWSER_NAVIGATE:
      case TOOL_NAME.BROWSER_SNAPSHOT:
      case TOOL_NAME.BROWSER_SCREENSHOT:
      case TOOL_NAME.BROWSER_SCRAPE:
      case TOOL_NAME.BROWSER_CLICK:
      case TOOL_NAME.BROWSER_TYPE:
      case TOOL_NAME.BROWSER_KEY: {
        const arguments_ = SessionGetToolInputSchema.passthrough().parse(action.arguments)
        const owned = await this.#access.requireSession(
          invocation,
          arguments_.sessionId,
          AUTHORIZATION_OPERATION.SESSION_ACTION,
        )
        const result = await this.options.browser.execute(action, owned.resource, invocation.signal)
        return { ownerId: owned.ownerId, ...result }
      }
    }
  }

  private now(): number {
    const value = this.options.clock.now()
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("AI clock rejected")
    return value
  }
}
