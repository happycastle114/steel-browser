import { createHash } from "node:crypto"

import {
  BINARY_CONTENT_TYPE,
  CONTROL_PLANE_API_VERSION,
  CreateIdempotencyKeySchema,
  PRINCIPAL_ROLE,
  PrincipalIdSchema,
  RESULT_KIND,
  SESSION_STATE,
  ResultIdSchema,
  SessionIdSchema,
  TOOL_NAME,
  TOOL_VERSION,
  UuidSchema,
  buildSessionUrls,
  parseControlPlaneConfig,
  selectConfiguredPublicOrigin,
  type AiActionRequest,
  type ControlPlaneConfig,
  type ResultId,
} from "@happycastle/steel-managed-shared"
import Fastify, { type FastifyInstance } from "fastify"
import {
  createManagedAiTransportPlugin,
  type AiAuditEvent,
  type AiAuditSink,
  type AuthenticatedPrincipal,
  type ControlPlaneExecutionPort,
  type ManagedAiTransportPlugin,
  type ManagedExecutionInvocation,
  type ResultIdFactory,
} from "../src/index.js"

export const RESULT_ID = ResultIdSchema.parse("11111111-1111-4111-8111-111111111111")
export const MCP_RESULT_ID = ResultIdSchema.parse("55555555-5555-4555-8555-555555555555")
export const SESSION_ID = SessionIdSchema.parse("22222222-2222-4222-8222-222222222222")
export const OWNER_ID = PrincipalIdSchema.parse("owner@example.net")
export const OTHER_OWNER_ID = PrincipalIdSchema.parse("other@example.net")
export const PUBLIC_HOST = "steel.soungmin.tech"
export const PUBLIC_ORIGIN = "https://steel.soungmin.tech"
export const REQUEST_ID = UuidSchema.parse("33333333-3333-4333-8333-333333333333")
export const CORRELATION_ID = UuidSchema.parse("44444444-4444-4444-8444-444444444444")

export function testConfig(overrides: Readonly<Record<string, unknown>> = {}): ControlPlaneConfig {
  return parseControlPlaneConfig({
    maxConcurrentManagedProjects: 1,
    activeManagerCount: 1,
    activeWorkerCount: 2,
    coldStandbyProjectCount: 1,
    managerBaseP95Bytes: 100_000_000,
    accessIssuer: "https://happycastle.cloudflareaccess.com",
    accessAudience: "steel-audience",
    allowedHosts: [PUBLIC_HOST],
    publicOriginByHost: { [PUBLIC_HOST]: PUBLIC_ORIGIN },
    operatorServicePrincipals: ["steel-operator"],
    poolId: "managed-blue",
    ...overrides,
  })
}

const selectedOrigin = selectConfiguredPublicOrigin(PUBLIC_HOST, testConfig())

export const NAVIGATE_ACTION: AiActionRequest = {
  apiVersion: CONTROL_PLANE_API_VERSION,
  tool: { name: TOOL_NAME.BROWSER_NAVIGATE, version: TOOL_VERSION },
  arguments: { sessionId: SESSION_ID, url: "https://example.com/" },
}
export const NAVIGATION_OUTPUT = {
  kind: RESULT_KIND.NAVIGATION,
  sessionId: SESSION_ID,
  url: "https://example.com/complete",
  title: "Complete",
  completedAt: "2026-07-21T00:00:00.000Z",
} as const
export const SESSION_CREATE_ACTION: AiActionRequest = {
  apiVersion: CONTROL_PLANE_API_VERSION,
  tool: { name: TOOL_NAME.SESSION_CREATE, version: TOOL_VERSION },
  arguments: { idempotencyKey: CreateIdempotencyKeySchema.parse("managed-test-session-create") },
}
export const SESSION_OUTPUT = {
  kind: RESULT_KIND.SESSION,
  session: {
    sessionId: SESSION_ID,
    state: SESSION_STATE.LIVE,
    createdAt: "2026-07-21T00:00:00.000Z",
    startedAt: "2026-07-21T00:00:01.000Z",
  },
  urls: buildSessionUrls(selectedOrigin, SESSION_ID),
} as const
export const SCREENSHOT_ACTION: AiActionRequest = {
  apiVersion: CONTROL_PLANE_API_VERSION,
  tool: { name: TOOL_NAME.BROWSER_SCREENSHOT, version: TOOL_VERSION },
  arguments: { sessionId: SESSION_ID, format: "png", fullPage: true },
}
export const SCREENSHOT_BYTES = new TextEncoder().encode("not-a-real-png-test-fixture")
export const SCREENSHOT_COMPLETION = {
  kind: RESULT_KIND.BINARY,
  sessionId: SESSION_ID,
  contentType: BINARY_CONTENT_TYPE.PNG,
  byteLength: SCREENSHOT_BYTES.byteLength,
  sha256: createHash("sha256").update(SCREENSHOT_BYTES).digest("hex"),
} as const

type TestPortOptions = Readonly<{
  readonly output?: unknown
  readonly ownerId?: AuthenticatedPrincipal["principalId"]
  readonly binaryBytes?: Uint8Array
  readonly completedAtMs?: number
  readonly execute?: (invocation: ManagedExecutionInvocation) => Promise<unknown>
}>

export class TestExecutionPort implements ControlPlaneExecutionPort {
  public readonly invocations: ManagedExecutionInvocation[] = []
  public constructor(private readonly options: TestPortOptions = {}) {}

  public async execute(invocation: ManagedExecutionInvocation): Promise<unknown> {
    this.invocations.push(invocation)
    if (this.options.execute !== undefined) return this.options.execute(invocation)
    return {
      resultId: invocation.resultId,
      action: invocation.action,
      ownerId: this.options.ownerId ?? OWNER_ID,
      completedAtMs: this.options.completedAtMs ?? 2_000,
      output: this.options.output ?? NAVIGATION_OUTPUT,
      ...(this.options.binaryBytes === undefined ? {} : { binaryBytes: this.options.binaryBytes }),
    }
  }
}

export class TestAuditSink implements AiAuditSink {
  public readonly events: AiAuditEvent[] = []
  public record(event: AiAuditEvent): void {
    this.events.push(event)
  }
}

export class FixedResultIdFactory implements ResultIdFactory {
  public constructor(private readonly value = RESULT_ID) {}
  public next() {
    return this.value
  }
}

export class SequenceResultIdFactory implements ResultIdFactory {
  #offset = 0
  public constructor(private readonly values: readonly ResultId[]) {}
  public next(): ResultId {
    const value = this.values[this.#offset]
    if (value === undefined) throw new RangeError("test result identifier sequence is exhausted")
    this.#offset += 1
    return value
  }
}

export function principal(
  principalId: AuthenticatedPrincipal["principalId"] = OWNER_ID,
  role: AuthenticatedPrincipal["role"] = PRINCIPAL_ROLE.USER,
): AuthenticatedPrincipal {
  return { principalId, role }
}

export async function createTestServer(input: Readonly<{
  readonly port?: ControlPlaneExecutionPort
  readonly identity?: AuthenticatedPrincipal
  readonly config?: ControlPlaneConfig
  readonly auditSink?: AiAuditSink
  readonly resultIdFactory?: ResultIdFactory
}> = {}): Promise<Readonly<{
  readonly app: FastifyInstance
  readonly transport: ManagedAiTransportPlugin
  readonly port: ControlPlaneExecutionPort
}>> {
  const config = input.config ?? testConfig()
  const port = input.port ?? new TestExecutionPort()
  const app = Fastify({ logger: false })
  app.addHook("onRequest", (request, _reply, done) => {
    if (typeof request.raw.socket.destroySoon !== "function") {
      Reflect.set(request.raw.socket, "destroySoon", () => undefined)
    }
    done()
  })
  const transport = createManagedAiTransportPlugin({
    config,
    serviceVersion: "1.0.0",
    executionPort: port,
    requestIdentity: () => ({
      principal: input.identity ?? principal(),
      context: { requestId: REQUEST_ID, correlationId: CORRELATION_ID },
      selectedOrigin: selectConfiguredPublicOrigin(PUBLIC_HOST, config),
    }),
    clock: { now: () => 1_000 },
    resultIdFactory: input.resultIdFactory ?? new FixedResultIdFactory(),
    auditSink: input.auditSink ?? new TestAuditSink(),
  })
  await app.register(transport.plugin)
  await app.ready()
  return Object.freeze({ app, transport, port })
}
