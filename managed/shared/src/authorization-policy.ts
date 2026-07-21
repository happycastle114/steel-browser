import { PRINCIPAL_ROLE, type PrincipalRole } from "./control-plane-vocabulary.js"
import type { PrincipalId } from "./control-plane-primitives.js"

export const AUTHORIZATION_ACCESS = {
  GLOBAL: "GLOBAL",
  OWN: "OWN",
  ANY_OWNER: "ANY_OWNER",
  CREATOR: "CREATOR",
  DENY: "DENY",
} as const
export type AuthorizationAccess = (typeof AUTHORIZATION_ACCESS)[keyof typeof AUTHORIZATION_ACCESS]

export const AUTHORIZATION_OPERATION = {
  HEALTH: "HEALTH",
  VERSION: "VERSION",
  CAPABILITIES: "CAPABILITIES",
  TOOL_DISCOVERY: "TOOL_DISCOVERY",
  SESSION_CREATE: "SESSION_CREATE",
  POOL_SUMMARY: "POOL_SUMMARY",
  SESSION_LIST: "SESSION_LIST",
  SESSION_DETAIL: "SESSION_DETAIL",
  SESSION_ACTION: "SESSION_ACTION",
  SESSION_UPGRADE: "SESSION_UPGRADE",
  SESSION_RELEASE: "SESSION_RELEASE",
  ADMISSION_DETAIL: "ADMISSION_DETAIL",
  ADMISSION_CANCEL: "ADMISSION_CANCEL",
  AI_ACTION: "AI_ACTION",
  MCP_RESOURCE: "MCP_RESOURCE",
  RESULT_DOWNLOAD: "RESULT_DOWNLOAD",
  WORKER_INVENTORY: "WORKER_INVENTORY",
  QUEUE_GLOBAL: "QUEUE_GLOBAL",
  EVENTS_GLOBAL: "EVENTS_GLOBAL",
  METRICS: "METRICS",
  POOL_DRAIN: "POOL_DRAIN",
  POOL_RESUME: "POOL_RESUME",
} as const
export type AuthorizationOperation = (typeof AUTHORIZATION_OPERATION)[keyof typeof AUTHORIZATION_OPERATION]

type AuthorizationRow = Readonly<Record<PrincipalRole, AuthorizationAccess>>

const globalRow = {
  [PRINCIPAL_ROLE.USER]: AUTHORIZATION_ACCESS.GLOBAL,
  [PRINCIPAL_ROLE.OPERATOR]: AUTHORIZATION_ACCESS.GLOBAL,
} as const satisfies AuthorizationRow
const ownerRow = {
  [PRINCIPAL_ROLE.USER]: AUTHORIZATION_ACCESS.OWN,
  [PRINCIPAL_ROLE.OPERATOR]: AUTHORIZATION_ACCESS.ANY_OWNER,
} as const satisfies AuthorizationRow
const operatorRow = {
  [PRINCIPAL_ROLE.USER]: AUTHORIZATION_ACCESS.DENY,
  [PRINCIPAL_ROLE.OPERATOR]: AUTHORIZATION_ACCESS.GLOBAL,
} as const satisfies AuthorizationRow
const creatorRow = {
  [PRINCIPAL_ROLE.USER]: AUTHORIZATION_ACCESS.CREATOR,
  [PRINCIPAL_ROLE.OPERATOR]: AUTHORIZATION_ACCESS.CREATOR,
} as const satisfies AuthorizationRow

export const AUTHORIZATION_MATRIX = {
  [AUTHORIZATION_OPERATION.HEALTH]: globalRow,
  [AUTHORIZATION_OPERATION.VERSION]: globalRow,
  [AUTHORIZATION_OPERATION.CAPABILITIES]: globalRow,
  [AUTHORIZATION_OPERATION.TOOL_DISCOVERY]: globalRow,
  [AUTHORIZATION_OPERATION.SESSION_CREATE]: globalRow,
  [AUTHORIZATION_OPERATION.POOL_SUMMARY]: globalRow,
  [AUTHORIZATION_OPERATION.SESSION_LIST]: ownerRow,
  [AUTHORIZATION_OPERATION.SESSION_DETAIL]: ownerRow,
  [AUTHORIZATION_OPERATION.SESSION_ACTION]: ownerRow,
  [AUTHORIZATION_OPERATION.SESSION_UPGRADE]: ownerRow,
  [AUTHORIZATION_OPERATION.SESSION_RELEASE]: ownerRow,
  [AUTHORIZATION_OPERATION.ADMISSION_DETAIL]: ownerRow,
  [AUTHORIZATION_OPERATION.ADMISSION_CANCEL]: ownerRow,
  [AUTHORIZATION_OPERATION.AI_ACTION]: ownerRow,
  [AUTHORIZATION_OPERATION.MCP_RESOURCE]: ownerRow,
  [AUTHORIZATION_OPERATION.RESULT_DOWNLOAD]: creatorRow,
  [AUTHORIZATION_OPERATION.WORKER_INVENTORY]: operatorRow,
  [AUTHORIZATION_OPERATION.QUEUE_GLOBAL]: operatorRow,
  [AUTHORIZATION_OPERATION.EVENTS_GLOBAL]: operatorRow,
  [AUTHORIZATION_OPERATION.METRICS]: operatorRow,
  [AUTHORIZATION_OPERATION.POOL_DRAIN]: operatorRow,
  [AUTHORIZATION_OPERATION.POOL_RESUME]: operatorRow,
} as const satisfies Readonly<Record<AuthorizationOperation, AuthorizationRow>>

export function authorizationAccess(role: PrincipalRole, operation: AuthorizationOperation): AuthorizationAccess {
  return AUTHORIZATION_MATRIX[operation][role]
}

export type OwnedAuthorizationResource<Resource> = Readonly<{
  readonly ownerId: PrincipalId
  readonly creatorId?: PrincipalId
  readonly resource: Resource
}>

export type AuthorizedResourceFilterInput<Resource> = Readonly<{
  readonly role: PrincipalRole
  readonly operation: AuthorizationOperation
  readonly principalId: PrincipalId
  readonly resources: readonly OwnedAuthorizationResource<Resource>[]
}>

function resourceIsVisible<Resource>(
  access: AuthorizationAccess,
  principalId: PrincipalId,
  owned: OwnedAuthorizationResource<Resource>,
): boolean {
  switch (access) {
    case AUTHORIZATION_ACCESS.GLOBAL:
    case AUTHORIZATION_ACCESS.ANY_OWNER:
      return true
    case AUTHORIZATION_ACCESS.OWN:
      return owned.ownerId === principalId
    case AUTHORIZATION_ACCESS.CREATOR:
      return owned.creatorId === principalId
    case AUTHORIZATION_ACCESS.DENY:
      return false
  }
}

export function filterAuthorizedResources<Resource>(input: AuthorizedResourceFilterInput<Resource>): readonly Resource[] {
  const access = authorizationAccess(input.role, input.operation)
  return input.resources
    .filter((resource) => resourceIsVisible(access, input.principalId, resource))
    .map((resource) => resource.resource)
}
