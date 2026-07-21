import { fileURLToPath } from "node:url"

import ts from "typescript"
import { describe, expect, it } from "vitest"

import {
  CREATE_JOURNAL_STATE,
  MANAGED_CREATE_HEADER,
  PRIVATE_SUPERVISOR_RESPONSE_KIND,
  PRIVATE_SUPERVISOR_RETRY_AFTER_HEADER_VALUE,
  PrivateSupervisorWireResponseSchema,
  WORKER_IDENTITY_HEADER,
} from "../src/private-supervisor-contract.js"

const TYPE_FIXTURE = fileURLToPath(new URL("fixtures/private-supervisor-consumer.ts", import.meta.url))
const INSTANCE_ID = "11223344-5566-4788-99aa-bbccddeeff00"
const SESSION_ID = "77c0575c-2513-4db5-a80e-8e2675041fcb"
const pending = {
  expiresAt: "2026-07-21T01:10:00.000Z",
  ownerSha256: "b".repeat(64),
  requestSha256: "c".repeat(64),
  state: CREATE_JOURNAL_STATE.UPSTREAM_PENDING,
  token: `h1_${"a".repeat(64)}`,
  updatedAt: "2026-07-21T01:00:00.000Z",
}
const complete = {
  ...pending,
  replay: { bodyTemplate: { id: SESSION_ID }, headers: {}, status: 200 },
  state: CREATE_JOURNAL_STATE.LIVE,
  upstreamSessionId: SESSION_ID,
}

function headers(body: unknown): Readonly<Record<string, string>> {
  return {
    [WORKER_IDENTITY_HEADER.INSTANCE_ID]: INSTANCE_ID,
    [WORKER_IDENTITY_HEADER.WORKER_ID]: "worker-00",
    "content-length": String(new TextEncoder().encode(JSON.stringify(body)).byteLength),
    "content-type": "application/json; charset=utf-8",
  }
}

describe("private supervisor exact wire types", () => {
  it.each([
    [CREATE_JOURNAL_STATE.ACCEPTED, PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_TOKEN_PENDING, 202],
    [CREATE_JOURNAL_STATE.UPSTREAM_PENDING, PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_TOKEN_PENDING, 202],
    [CREATE_JOURNAL_STATE.UNCERTAIN, PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_TOKEN_PENDING, 202],
    [CREATE_JOURNAL_STATE.LIVE, PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_TOKEN_COMPLETE, 200],
    [CREATE_JOURNAL_STATE.RELEASED_TERMINAL, PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_TOKEN_COMPLETE, 200],
    [CREATE_JOURNAL_STATE.FAILED_TERMINAL, PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_TOKEN_COMPLETE, 200],
  ] as const)("accepts the exact lookup wire outcome for journal state %s", (state, kind, status) => {
    // Given: one canonical record for the selected pending or complete state.
    const body = status === 202 ? { ...pending, state } : { ...complete, state }
    const responseHeaders = status === 202
      ? { ...headers(body), "retry-after": PRIVATE_SUPERVISOR_RETRY_AFTER_HEADER_VALUE }
      : headers(body)

    // When: the state-bound lookup response crosses the wire schema.
    const result = PrivateSupervisorWireResponseSchema.safeParse({ body, headers: responseHeaders, kind, status })

    // Then: every declared journal state has exactly one successful outcome family.
    expect(result.success).toBe(true)
  })

  it("requires literal retry metadata only on pending responses at compile time", () => {
    // Given: a consumer whose type assertions encode the exact retry-header surface.
    const program = ts.createProgram({
      rootNames: [TYPE_FIXTURE],
      options: {
        exactOptionalPropertyTypes: true,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        noEmit: true,
        noUncheckedIndexedAccess: true,
        skipLibCheck: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
        verbatimModuleSyntax: true,
      },
    })

    // When: TypeScript checks the emitted consumer contract.
    const diagnostics = ts.getPreEmitDiagnostics(program)

    // Then: required literal "1" and retry omission assertions all compile.
    expect(diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([])
  }, 15_000)

  it("rejects a wrong small content length and retry leakage on completion", () => {
    // Given: two otherwise-valid wire responses carrying independent header mutations.
    const pendingHeaders = headers(pending)
    const wrongLength = String(Number(pendingHeaders["content-length"]) - 1)
    const mutations = [
      {
        body: pending,
        headers: { ...pendingHeaders, "content-length": wrongLength, "retry-after": PRIVATE_SUPERVISOR_RETRY_AFTER_HEADER_VALUE },
        kind: PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_TOKEN_PENDING,
        status: 202,
      },
      {
        body: complete,
        headers: { ...headers(complete), "retry-after": PRIVATE_SUPERVISOR_RETRY_AFTER_HEADER_VALUE },
        kind: PRIVATE_SUPERVISOR_RESPONSE_KIND.CREATES_TOKEN_COMPLETE,
        status: 200,
      },
    ]

    // When: both mutations cross the strict wire boundary.
    const results = mutations.map((value) => PrivateSupervisorWireResponseSchema.safeParse(value))

    // Then: neither a forged length nor retry leakage is representable.
    expect(results.every((result) => !result.success)).toBe(true)
  })

  it("publishes independently fixed normalized header names", () => {
    // Given: the public header vocabularies.
    const identity = Object.values(WORKER_IDENTITY_HEADER)
    const create = Object.values(MANAGED_CREATE_HEADER)

    // When: consumers enumerate their normalized wire keys.
    const headersByPurpose = { create, identity }

    // Then: manager and worker share exact lowercase names without principal or key material.
    expect(headersByPurpose).toEqual({
      create: [
        "x-managed-pool-id",
        "x-managed-manager-instance-id",
        "x-managed-create-token",
        "x-managed-owner-sha256",
        "x-managed-request-sha256",
      ],
      identity: ["x-managed-worker-id", "x-managed-worker-instance-id"],
    })
  })
})
