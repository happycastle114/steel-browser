import { describe, expect, it } from "vitest"

import { CONTROL_PLANE_API_VERSION } from "../src/control-plane-contract.js"
import {
  CreateReplayRecordSchema,
  PUBLIC_URL_KIND,
} from "../src/create-replay-contract.js"
import {
  ADMISSION_STATE,
  CREATE_REPLAY_STATE,
  CREATE_REPLAY_TEMPLATE_KIND,
  EVENT_TYPE,
  SESSION_STATE,
  WORKER_STATE,
} from "../src/control-plane-vocabulary.js"
import {
  AdmissionSchema,
  ManagedEventSchema,
  SessionListSchema,
  SessionSchema,
  VersionSchema,
  WorkerSchema,
} from "../src/control-plane-resources.js"
import { MANAGED_RELEASE_EVIDENCE_MODE } from "../src/managed-release-evidence.js"

const ids = {
  bootId: "018f56c8-6f7a-4c45-9e5d-77adff18f7ac",
  instanceId: "218f56c8-6f7a-4c45-9e5d-77adff18f7ac",
  sessionId: "318f56c8-6f7a-4c45-9e5d-77adff18f7ac",
  admissionId: "418f56c8-6f7a-4c45-9e5d-77adff18f7ac",
}

const versionResource = {
  apiVersion: CONTROL_PLANE_API_VERSION,
  upstreamSha: "a".repeat(40),
  managedSha: "b".repeat(40),
  managerDigest: `sha256:${"c".repeat(64)}`,
  workerDigest: `sha256:${"d".repeat(64)}`,
  browserVersion: "140.0.0",
  toolchainLockSha256: "e".repeat(64),
  managerConfigSha256: "1".repeat(64),
  releaseEvidenceSha256: "2".repeat(64),
  releaseEvidenceMode: MANAGED_RELEASE_EVIDENCE_MODE.CONFIG_FILE,
  createTokenKeyId: "f".repeat(16),
  startedAt: "2026-07-20T00:00:00.000Z",
}

describe("exact managed resource schemas", () => {
  it.each([
    [WorkerSchema, { workerId: "worker-00", instanceId: ids.instanceId, state: WORKER_STATE.IDLE, lastSeenAt: "2026-07-20T00:00:00.000Z", stateChangedAt: "2026-07-20T00:00:00.000Z" }],
    [SessionSchema, { sessionId: ids.sessionId, state: SESSION_STATE.LIVE, workerId: "worker-00", instanceId: ids.instanceId, admissionId: ids.admissionId, createdAt: "2026-07-20T00:00:00.000Z", startedAt: "2026-07-20T00:00:01.000Z" }],
    [AdmissionSchema, { admissionId: ids.admissionId, state: ADMISSION_STATE.ADMITTED, sessionId: ids.sessionId, createdAt: "2026-07-20T00:00:00.000Z", expiresAt: "2026-07-20T00:02:00.000Z", updatedAt: "2026-07-20T00:00:01.000Z" }],
    [VersionSchema, versionResource],
  ] as const)("parses strict resource %#", (schema, resource) => {
    // Given: a resource matching its declared wire shape.
    // When: the boundary schema parses it.
    const result = schema.safeParse(resource)
    // Then: the resource is accepted.
    expect(result.success).toBe(true)
  })

  it("parses a complete immutable session list page", () => {
    // Given: an offset-zero frozen session projection.
    const input = {
      apiVersion: CONTROL_PLANE_API_VERSION,
      items: [],
      page: { pageSize: 50, snapshotCursor: "eyJ2IjoxfQ", hasMore: false },
    }
    // When: the list boundary parses it.
    const result = SessionListSchema.safeParse(input)
    // Then: terminal nextCursor omission is accepted.
    expect(result.success).toBe(true)
  })

  it.each([
    ["manager config digest", "managerConfigSha256"],
    ["release evidence digest", "releaseEvidenceSha256"],
    ["release evidence mode", "releaseEvidenceMode"],
  ] as const)("requires the version %s", (_name, key) => {
    // Given: an otherwise valid version response without one startup evidence fact.
    const input = { ...versionResource }
    delete input[key]

    // When: the response crosses the public version boundary.
    const result = VersionSchema.safeParse(input)

    // Then: startup evidence cannot be omitted.
    expect(result.success).toBe(false)
  })

  it("requires CONFIG_FILE release evidence mode", () => {
    // Given: an otherwise valid version response claiming an ambient mode.
    const input = { ...versionResource, releaseEvidenceMode: "AMBIENT" }

    // When/Then: only externally SHA-bound config-file evidence is accepted.
    expect(VersionSchema.safeParse(input).success).toBe(false)
  })
})

describe("event and create replay wire schemas", () => {
  it("keeps event sequence as canonical decimal string", () => {
    // Given: the first worker transition in one boot.
    const input = {
      apiVersion: CONTROL_PLANE_API_VERSION,
      eventId: `${ids.bootId}:1`,
      bootId: ids.bootId,
      sequence: "1",
      type: EVENT_TYPE.WORKER_STATE_CHANGED,
      occurredAt: "2026-07-20T00:00:00.000Z",
      workerId: "worker-00",
      instanceId: ids.instanceId,
      payload: { from: WORKER_STATE.DISCOVERED, to: WORKER_STATE.REACHABLE },
    }
    // When: the event boundary parses it.
    const result = ManagedEventSchema.safeParse(input)
    // Then: the event is accepted without JSON-number conversion.
    expect(result.success).toBe(true)
    expect(ManagedEventSchema.safeParse({ ...input, sequence: 1 }).success).toBe(false)
    expect(ManagedEventSchema.safeParse({ ...input, eventId: `${ids.bootId}:2` }).success).toBe(false)
  })

  it("parses a bounded live replay with a typed URL placeholder", () => {
    // Given: a worker journal record whose public URL is deferred to request Host.
    const input = {
      token: `h1_${"a".repeat(64)}`,
      ownerSha256: "b".repeat(64),
      requestSha256: "c".repeat(64),
      state: CREATE_REPLAY_STATE.LIVE,
      upstreamSessionId: ids.sessionId,
      replay: {
        status: 200,
        headers: { contentType: "application/json" },
        bodyTemplate: {
          id: ids.sessionId,
          websocketUrl: { kind: CREATE_REPLAY_TEMPLATE_KIND.PUBLIC_URL, urlKind: PUBLIC_URL_KIND.WEBSOCKET, sessionId: ids.sessionId },
        },
      },
      updatedAt: "2026-07-20T00:00:01.000Z",
      expiresAt: "2026-07-20T00:10:01.000Z",
    }
    // When: the replay boundary parses it.
    const result = CreateReplayRecordSchema.safeParse(input)
    // Then: only the typed placeholder form is retained.
    expect(result.success).toBe(true)
  })
})
