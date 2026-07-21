import { createHash } from "node:crypto"
import {
  ManagedListSnapshotStore,
  ManagedTransportError,
  type ManagedExecutionInvocation,
  type ManagedOperationsPort,
} from "@happycastle/steel-managed-gateway"
import {
  AUTHORIZATION_OPERATION,
  LIST_RESOURCE_KIND,
  MANAGED_ERROR_CODE,
  SessionListToolInputSchema,
  Sha256Schema,
  TOOL_NAME,
  filterAuthorizedResources,
  type Admission,
  type AdmissionId,
  type AuthorizationOperation,
  type OwnedAuthorizationResource,
  type Session,
  type SessionId,
} from "@happycastle/steel-managed-shared"

type AiResourceAccessOptions = Readonly<{
  operations: Pick<
    ManagedOperationsPort,
    "captureSessions" | "findAdmission" | "findSession"
  >
  sessionSnapshots: ManagedListSnapshotStore
}>

export class AiResourceAccess {
  public constructor(private readonly options: AiResourceAccessOptions) {}

  public async listSessions(invocation: ManagedExecutionInvocation) {
    if (invocation.action.tool.name !== TOOL_NAME.SESSION_LIST) throw invalidAction()
    const query = SessionListToolInputSchema.parse(invocation.action.arguments)
    const principalDigest = Sha256Schema.parse(
      createHash("sha256").update(invocation.principal.principalId).digest("hex"),
    )
    if (query.cursor !== undefined) {
      return this.options.sessionSnapshots.continue({
        kind: LIST_RESOURCE_KIND.SESSIONS,
        cursor: query.cursor,
        principalDigest,
        ...(query.pageSize === undefined ? {} : { pageSize: query.pageSize }),
        ...(query.state === undefined ? {} : { states: query.state }),
      }).value
    }
    const items = filterAuthorizedResources({
      operation: AUTHORIZATION_OPERATION.SESSION_LIST,
      principalId: invocation.principal.principalId,
      resources: await this.options.operations.captureSessions(),
      role: invocation.principal.role,
    })
    return this.options.sessionSnapshots.create({
      kind: LIST_RESOURCE_KIND.SESSIONS,
      items,
      pageSize: query.pageSize ?? 50,
      principalDigest,
      states: query.state ?? [],
    }).value
  }

  public async requireSession(
    invocation: ManagedExecutionInvocation,
    sessionId: SessionId,
    operation: Extract<AuthorizationOperation,
      | typeof AUTHORIZATION_OPERATION.SESSION_ACTION
      | typeof AUTHORIZATION_OPERATION.SESSION_DETAIL
      | typeof AUTHORIZATION_OPERATION.SESSION_RELEASE
    >,
  ): Promise<OwnedAuthorizationResource<Session>> {
    const found = await this.options.operations.findSession(sessionId)
    if (found === undefined || !visible(invocation, operation, found)) {
      throw new ManagedTransportError(
        MANAGED_ERROR_CODE.SESSION_NOT_FOUND,
        "The session was not found",
      )
    }
    return found
  }

  public async requireAdmission(
    invocation: ManagedExecutionInvocation,
    admissionId: AdmissionId,
  ): Promise<OwnedAuthorizationResource<Admission>> {
    const found = await this.options.operations.findAdmission(admissionId)
    if (
      found === undefined ||
      !visible(invocation, AUTHORIZATION_OPERATION.ADMISSION_DETAIL, found)
    ) {
      throw new ManagedTransportError(
        MANAGED_ERROR_CODE.ADMISSION_NOT_FOUND,
        "The admission was not found",
      )
    }
    return found
  }
}

function visible<Resource>(
  invocation: ManagedExecutionInvocation,
  operation: AuthorizationOperation,
  resource: OwnedAuthorizationResource<Resource>,
): boolean {
  return filterAuthorizedResources({
    operation,
    principalId: invocation.principal.principalId,
    resources: [resource],
    role: invocation.principal.role,
  }).length === 1
}

function invalidAction(): ManagedTransportError {
  return new ManagedTransportError(
    MANAGED_ERROR_CODE.TOOL_INPUT_INVALID,
    "The action was invalid",
  )
}
