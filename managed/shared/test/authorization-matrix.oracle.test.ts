import { describe, expect, it } from "vitest"

import {
  AUTHORIZATION_ACCESS,
  AUTHORIZATION_OPERATION,
  authorizationAccess,
  filterAuthorizedResources,
  type AuthorizationAccess,
  type AuthorizationOperation,
} from "../src/authorization-policy.js"
import { PRINCIPAL_ROLE, type PrincipalRole } from "../src/control-plane-vocabulary.js"
import { PrincipalIdSchema } from "../src/control-plane-primitives.js"

type Row = Readonly<Record<PrincipalRole, AuthorizationAccess>>

const globalRow: Row = { USER: AUTHORIZATION_ACCESS.GLOBAL, OPERATOR: AUTHORIZATION_ACCESS.GLOBAL }
const ownerRow: Row = { USER: AUTHORIZATION_ACCESS.OWN, OPERATOR: AUTHORIZATION_ACCESS.ANY_OWNER }
const operatorRow: Row = { USER: AUTHORIZATION_ACCESS.DENY, OPERATOR: AUTHORIZATION_ACCESS.GLOBAL }
const creatorRow: Row = { USER: AUTHORIZATION_ACCESS.CREATOR, OPERATOR: AUTHORIZATION_ACCESS.CREATOR }

const EXPECTED_AUTHORIZATION: Readonly<Record<AuthorizationOperation, Row>> = {
  HEALTH: globalRow,
  VERSION: globalRow,
  CAPABILITIES: globalRow,
  TOOL_DISCOVERY: globalRow,
  SESSION_CREATE: globalRow,
  POOL_SUMMARY: globalRow,
  SESSION_LIST: ownerRow,
  SESSION_DETAIL: ownerRow,
  SESSION_ACTION: ownerRow,
  SESSION_UPGRADE: ownerRow,
  SESSION_RELEASE: ownerRow,
  ADMISSION_DETAIL: ownerRow,
  ADMISSION_CANCEL: ownerRow,
  AI_ACTION: ownerRow,
  MCP_RESOURCE: ownerRow,
  RESULT_DOWNLOAD: creatorRow,
  WORKER_INVENTORY: operatorRow,
  QUEUE_GLOBAL: operatorRow,
  EVENTS_GLOBAL: operatorRow,
  METRICS: operatorRow,
  POOL_DRAIN: operatorRow,
  POOL_RESUME: operatorRow,
}

describe("independent authorization matrix oracle", () => {
  it("asserts every operation by every principal role", () => {
    // Given: an authoritative expected table declared independently from production rows.
    const operations = Object.values(AUTHORIZATION_OPERATION)
    const roles = Object.values(PRINCIPAL_ROLE)
    // When: every operation-role cell is queried through the public function.
    const observed = operations.flatMap((operation) => roles.map((role) => authorizationAccess(role, operation)))
    // Then: all forty-four decisions match the independent table exactly.
    expect(observed).toEqual(operations.flatMap((operation) => roles.map((role) => EXPECTED_AUTHORIZATION[operation][role])))
  })

  it("keeps user session listing owner-scoped", () => {
    // Given: two private session projections owned by different principals.
    const alice = PrincipalIdSchema.parse("alice@example.com")
    const bob = PrincipalIdSchema.parse("bob@example.com")
    const sessions = [
      { ownerId: alice, resource: { sessionId: "alice-session" } },
      { ownerId: bob, resource: { sessionId: "bob-session" } },
    ]
    // When: the normal user and operator list the same registry snapshot.
    const userVisible = filterAuthorizedResources({
      role: PRINCIPAL_ROLE.USER,
      operation: AUTHORIZATION_OPERATION.SESSION_LIST,
      principalId: alice,
      resources: sessions,
    })
    const operatorVisible = filterAuthorizedResources({
      role: PRINCIPAL_ROLE.OPERATOR,
      operation: AUTHORIZATION_OPERATION.SESSION_LIST,
      principalId: alice,
      resources: sessions,
    })
    // Then: USER sees only owned resources while OPERATOR retains any-owner access.
    expect(userVisible).toEqual([{ sessionId: "alice-session" }])
    expect(operatorVisible).toEqual([{ sessionId: "alice-session" }, { sessionId: "bob-session" }])
  })
})
