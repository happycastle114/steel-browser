import { createHash } from "node:crypto"

import { AiBrowserService } from "../src/api/managed/action-service.js"
import { AI_AUDIT_REASON } from "../src/api/managed/execution-contract.js"
import { ManagedTransportError } from "../src/api/managed/transport-error.js"
import {
  InMemoryRetainedResultStore,
  RETAINED_RESULT_CONTENT,
  type RetainedResultRecord,
  type RetainedResultStore,
} from "../src/api/managed/retained-result-store.js"
import { RESULT_LOOKUP_KIND } from "../src/api/managed/service-contract.js"
import {
  AI_ASYNC_OUTCOME_STATE,
  CONTROL_PLANE_API_VERSION,
  MANAGED_ERROR_CODE,
  RESULT_KIND,
  TOOL_NAME,
  TOOL_VERSION,
  TEXT_RESULT_FORMAT,
  selectConfiguredPublicOrigin,
  type AiActionRequest,
  type ResultId,
} from "@happycastle/steel-managed-shared"
import { describe, expect, it } from "vitest"
import {
  CORRELATION_ID,
  NAVIGATE_ACTION,
  NAVIGATION_OUTPUT,
  OTHER_OWNER_ID,
  OWNER_ID,
  PUBLIC_HOST,
  REQUEST_ID,
  RESULT_ID,
  SCREENSHOT_ACTION,
  SCREENSHOT_BYTES,
  SCREENSHOT_COMPLETION,
  SESSION_ID,
  FixedResultIdFactory,
  TestAuditSink,
  TestExecutionPort,
  principal,
  testConfig,
} from "./managed-transport-test-support.js"

function createService(input: Readonly<{
  readonly port?: TestExecutionPort
  readonly store?: RetainedResultStore
  readonly audit?: TestAuditSink
  readonly config?: ReturnType<typeof testConfig>
}> = {}) {
  const config = input.config ?? testConfig()
  const audit = input.audit ?? new TestAuditSink()
  const service = new AiBrowserService({
    config,
    executionPort: input.port ?? new TestExecutionPort(),
    clock: { now: () => 1_000 },
    resultIdFactory: new FixedResultIdFactory(),
    auditSink: audit,
    resultStore: input.store,
  })
  return { service, audit, selectedOrigin: selectConfiguredPublicOrigin(PUBLIC_HOST, config) }
}

function request(action: AiActionRequest, selectedOrigin: ReturnType<typeof selectConfiguredPublicOrigin>) {
  return {
    action,
    principal: principal(),
    context: { requestId: REQUEST_ID, correlationId: CORRELATION_ID },
    selectedOrigin,
    signal: new AbortController().signal,
  }
}

function resultRequest(selectedOrigin: ReturnType<typeof selectConfiguredPublicOrigin>) {
  return {
    resultId: RESULT_ID,
    principal: principal(),
    context: { requestId: REQUEST_ID, correlationId: CORRELATION_ID },
    selectedOrigin,
  }
}

const snapshotAction: AiActionRequest = {
  apiVersion: CONTROL_PLANE_API_VERSION,
  tool: { name: TOOL_NAME.BROWSER_SNAPSHOT, version: TOOL_VERSION },
  arguments: { sessionId: SESSION_ID },
}

describe("managed AI two-phase result service", () => {
  it("accepts before execution completes and exposes a typed pending result", async () => {
    let complete: (() => void) | undefined
    const port = new TestExecutionPort({
      execute: (invocation) => new Promise((resolve) => {
        complete = () => resolve({
          resultId: invocation.resultId,
          action: invocation.action,
          ownerId: OWNER_ID,
          completedAtMs: 2_000,
          output: NAVIGATION_OUTPUT,
        })
      }),
    })
    const { service, selectedOrigin } = createService({ port })

    const accepted = service.submit(request(NAVIGATE_ACTION, selectedOrigin))
    const pending = service.result(resultRequest(selectedOrigin))

    expect(accepted.body.resultId).toBe(RESULT_ID)
    expect(pending).toMatchObject({
      kind: RESULT_LOOKUP_KIND.PENDING,
      outcome: { status: 202, body: { resultId: RESULT_ID, state: AI_ASYNC_OUTCOME_STATE.PENDING } },
    })
    expect(service.gauges()).toMatchObject({ action: { active: 1 }, result: { inFlightCount: 1 } })
    if (complete === undefined) throw new TypeError("completion callback was not installed")
    complete()

    const completed = await service.waitForResult(resultRequest(selectedOrigin))
    expect(completed.output).toEqual(NAVIGATION_OUTPUT)
    expect(service.result(resultRequest(selectedOrigin))).toMatchObject({
      kind: RESULT_LOOKUP_KIND.COMPLETED,
      value: { output: NAVIGATION_OUTPUT },
    })
  })

  it("releases its reservation when config-bound text output is one byte too large", async () => {
    const config = testConfig({ httpBodyBytes: 65_536, aiTextBytes: 65_536 })
    const text = "x".repeat(65_536)
    const port = new TestExecutionPort({
      output: {
        kind: RESULT_KIND.TEXT,
        sessionId: SESSION_ID,
        format: TEXT_RESULT_FORMAT.ACCESSIBILITY,
        text,
        truncated: true,
        byteLength: 65_537,
        deliveredByteLength: 65_536,
        sha256: createHash("sha256").update(text).digest("hex"),
      },
    })
    const { service, selectedOrigin } = createService({ config, port })

    const accepted = service.submit(request(snapshotAction, selectedOrigin))
    await expect(service.waitForResult({ ...resultRequest(selectedOrigin), resultId: accepted.body.resultId })).rejects.toMatchObject({
      code: MANAGED_ERROR_CODE.RESULT_TOO_LARGE,
    })
    expect(() => service.result(resultRequest(selectedOrigin))).toThrowError(expect.objectContaining({
      code: MANAGED_ERROR_CODE.RESULT_TOO_LARGE,
    }))
    expect(port.invocations).toHaveLength(1)
    expect(service.gauges()).toMatchObject({
      action: { active: 0 },
      result: { reservedCount: 1, retainedCount: 1, inFlightCount: 0 },
    })
  })

  it("aborts a prepared reservation when staging fails", async () => {
    const store = new RejectingStore()
    const audit = new TestAuditSink()
    const { service, selectedOrigin } = createService({ store, audit })

    const accepted = service.submit(request(NAVIGATE_ACTION, selectedOrigin))
    await expect(service.waitForResult({ ...resultRequest(selectedOrigin), resultId: accepted.body.resultId })).rejects.toMatchObject({
      code: MANAGED_ERROR_CODE.UPSTREAM_BAD_RESPONSE,
    })
    expect(service.gauges().result).toMatchObject({
      reservedCount: 1,
      retainedCount: 1,
      inFlightCount: 0,
    })
    expect(audit.events).toContainEqual({
      reason: AI_AUDIT_REASON.RESULT_STORE_FAILURE,
      resultId: RESULT_ID,
      principalId: OWNER_ID,
    })
    expect(() => service.result({
      ...resultRequest(selectedOrigin),
      principal: principal(OTHER_OWNER_ID),
    })).toThrowError(expect.objectContaining({ code: MANAGED_ERROR_CODE.RESULT_NOT_FOUND }))
  })

  it("quarantines a corrupt retained binary and returns indistinguishable not-found", async () => {
    const store = new CorruptingStore()
    const audit = new TestAuditSink()
    const port = new TestExecutionPort({ output: SCREENSHOT_COMPLETION, binaryBytes: SCREENSHOT_BYTES })
    const { service, selectedOrigin } = createService({ store, audit, port })
    const accepted = service.submit(request(SCREENSHOT_ACTION, selectedOrigin))
    await service.waitForResult({ ...resultRequest(selectedOrigin), resultId: accepted.body.resultId })
    store.corrupt()

    expect(() => service.result(resultRequest(selectedOrigin))).toThrowError(ManagedTransportError)
    expect(service.gauges().result.reservedCount).toBe(0)
    expect(audit.events.at(-1)).toMatchObject({ reason: AI_AUDIT_REASON.CORRUPT_RETAINED_RECORD })
  })

  it("closes idempotently, aborts active work, and ignores a late worker completion", async () => {
    let complete: (() => void) | undefined
    const port = new TestExecutionPort({
      execute: (invocation) => new Promise((resolve) => {
        complete = () => resolve({
          resultId: invocation.resultId,
          action: invocation.action,
          ownerId: OWNER_ID,
          completedAtMs: 2_000,
          output: NAVIGATION_OUTPUT,
        })
      }),
    })
    const { service, selectedOrigin } = createService({ port })
    const accepted = service.submit(request(NAVIGATE_ACTION, selectedOrigin))
    const pending = service.waitForResult({ ...resultRequest(selectedOrigin), resultId: accepted.body.resultId })
    await Promise.resolve()
    service.close()
    service.close()
    if (complete === undefined) throw new TypeError("late completion callback was not installed")
    complete()

    await expect(pending).rejects.toMatchObject({ code: MANAGED_ERROR_CODE.MANAGER_DRAINING })
    expect(service.gauges()).toMatchObject({
      action: { active: 0, closed: true },
      result: { reservedCount: 0, retainedCount: 0 },
    })
  })
})

class RejectingStore implements RetainedResultStore {
  public stage(): boolean { return false }
  public publish(): boolean { return false }
  public get(): undefined { return undefined }
  public delete(): boolean { return false }
  public prune(): readonly ResultId[] { return [] }
  public clear(): readonly ResultId[] { return [] }
  public records(): readonly RetainedResultRecord[] { return [] }
  public size(): number { return 0 }
}

class CorruptingStore implements RetainedResultStore {
  readonly #delegate = new InMemoryRetainedResultStore()
  #corrupt = false
  public corrupt(): void { this.#corrupt = true }
  public stage(record: RetainedResultRecord): boolean { return this.#delegate.stage(record) }
  public publish(resultId: ResultId): boolean { return this.#delegate.publish(resultId) }
  public get(resultId: ResultId): RetainedResultRecord | undefined {
    const record = this.#delegate.get(resultId)
    if (!this.#corrupt || record?.content !== RETAINED_RESULT_CONTENT.BINARY) return record
    return Object.freeze({ ...record, bytes: new Uint8Array([0]) })
  }
  public delete(resultId: ResultId): boolean { return this.#delegate.delete(resultId) }
  public prune(nowMs: number): readonly ResultId[] { return this.#delegate.prune(nowMs) }
  public clear(): readonly ResultId[] { return this.#delegate.clear() }
  public records(): readonly RetainedResultRecord[] { return this.#delegate.records() }
  public size(): number { return this.#delegate.size() }
}
