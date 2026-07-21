import {
  AllocationIdSchema,
  InstanceIdSchema,
  LifecycleCreateKind,
  PublicHttpMethod,
  PublicSessionIdSchema,
  SessionState,
  UpstreamSessionState,
  UpstreamSessionIdSchema,
  WorkerIdSchema,
  WorkerOriginSchema,
} from "@happycastle/steel-managed-gateway"
import {
  MANAGED_CREATE_HEADER,
  ManagedCreateHeaderValuesSchema,
  PrincipalIdSchema,
} from "@happycastle/steel-managed-shared"
import { describe, expect, it } from "vitest"
import { ManagerCompatibilityLifecycle } from "../src/http/compatibility-lifecycle.js"

const PRINCIPAL_ID = PrincipalIdSchema.parse("USER:compatibility-owner")
const SESSION_ID = PublicSessionIdSchema.parse(
  "00000000-0000-4000-8000-000000000101",
)
const SESSION = {
  allocationId: AllocationIdSchema.parse("allocation-compatibility"),
  createdAt: 1_000,
  instanceId: InstanceIdSchema.parse(
    "00000000-0000-4000-8000-000000000201",
  ),
  publicSessionId: SESSION_ID,
  state: SessionState.LIVE,
  upstreamSessionId: UpstreamSessionIdSchema.parse(SESSION_ID),
  workerId: WorkerIdSchema.parse("worker-00"),
} as const

describe("manager compatibility lifecycle", () => {
  it("tracks the authenticated owner and synthesizes a rewriteable upstream response", async () => {
    let tracked = false
    const lifecycle = new ManagerCompatibilityLifecycle({
      admissions: {
        releaseCompatibilitySession: async () => {
          throw new TypeError("release not expected")
        },
        trackLifecycleResult: (principalId, result) => {
          expect(principalId).toBe(PRINCIPAL_ID)
          expect(result.kind).toBe(LifecycleCreateKind.CREATED)
          tracked = true
        },
      },
      createHeaders: async () => ManagedCreateHeaderValuesSchema.parse({
        [MANAGED_CREATE_HEADER.MANAGER_INSTANCE_ID]: "00000000-0000-4000-8000-000000000401",
        [MANAGED_CREATE_HEADER.OWNER_SHA256]: "a".repeat(64),
        [MANAGED_CREATE_HEADER.POOL_ID]: "test-pool",
        [MANAGED_CREATE_HEADER.REQUEST_SHA256]: "b".repeat(64),
        [MANAGED_CREATE_HEADER.TOKEN]: `r1_00000000-0000-4000-8000-000000000501`,
      }),
      lifecycle: {
        create: async () => ({ kind: LifecycleCreateKind.CREATED, session: SESSION }),
      },
      pool: { requireServing: () => undefined },
      registry: {
        session: () => SESSION,
        workerForSession: () => ({
          instanceId: SESSION.instanceId,
          origin: WorkerOriginSchema.parse("http://worker-00:3000"),
          workerId: SESSION.workerId,
        }),
      },
      wait: async () => undefined,
      waitMilliseconds: 10_000,
    })

    const created = await lifecycle.create({
      headers: {},
      method: PublicHttpMethod.POST,
      pathAndQuery: "/v1/sessions",
      principalId: PRINCIPAL_ID,
      signal: new AbortController().signal,
    })
    const body = JSON.parse(created.response.body.toString("utf8"))

    expect(tracked).toBe(true)
    expect(body).toMatchObject({
      id: SESSION_ID,
      status: UpstreamSessionState.LIVE,
      websocketUrl: "ws://worker-00:3000/",
    })
  })
})
