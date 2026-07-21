import { describe, expect, it } from "vitest"
import {
  AllocationIdSchema,
  AmbiguousSessionAffinityError,
  EventLedger,
  SessionNotFoundError,
  WorkerRegistry,
  WorkerRemoteState,
} from "../src/index.js"
import {
  InvalidWebSocketQueryError,
  ManagedWebSocketRouteId,
  WebSocketRouteNotFoundError,
  resolveWebSocketUpgrade,
} from "../src/websocket/upgrade-router.js"
import {
  FakeClock,
  publicSessionId,
  upstreamSessionId,
  workerDescriptor,
} from "./test-support.js"

function registryWithSessions(count: number): WorkerRegistry {
  const clock = new FakeClock()
  const registry = new WorkerRegistry({ clock, ledger: new EventLedger({ clock }) })
  for (let sequence = 0; sequence < count; sequence += 1) {
    const worker = workerDescriptor(sequence, 1)
    registry.commitObservation(registry.beginObservation(worker.workerId), {
      worker,
      remoteState: WorkerRemoteState.IDLE,
      sessions: [],
    })
    const allocationId = AllocationIdSchema.parse(`allocation-ws-${sequence}`)
    registry.reserveNext(allocationId)
    registry.bindSession({
      allocationId,
      publicSessionId: publicSessionId(sequence + 1),
      upstreamSessionId: upstreamSessionId(sequence + 1),
    })
  }
  return registry
}

describe("resolveWebSocketUpgrade", () => {
  it("routes a public cast path to its exact worker and controlled legacy path", () => {
    // Given
    const registry = registryWithSessions(2)
    const firstId = publicSessionId(1)

    // When
    const target = resolveWebSocketUpgrade({
      headers: {},
      pathAndQuery: `/v1/sessions/${firstId}/cast?pageId=page-a&sessionId=${publicSessionId(2)}`,
      registry,
    })

    // Then
    expect(target).toMatchObject({
      routeId: ManagedWebSocketRouteId.CAST,
      sessionId: firstId,
      upstreamPathAndQuery: "/v1/sessions/cast?pageId=page-a",
      worker: { workerId: "worker-00" },
    })
  })

  it("uses the session header before query affinity on a root CDP socket", () => {
    // Given
    const registry = registryWithSessions(2)
    const firstId = publicSessionId(1)
    const secondId = publicSessionId(2)

    // When
    const target = resolveWebSocketUpgrade({
      headers: { "x-steel-session-id": secondId },
      pathAndQuery: `/?sessionId=${firstId}`,
      registry,
    })

    // Then
    expect(target).toMatchObject({
      routeId: ManagedWebSocketRouteId.CDP,
      sessionId: secondId,
      upstreamPathAndQuery: "/",
      worker: { workerId: "worker-01" },
    })
  })

  it("keeps singleton legacy handler compatibility but rejects ambiguous affinity", () => {
    // Given / When
    const singleton = resolveWebSocketUpgrade({
      headers: {},
      pathAndQuery: "/v1/sessions/logs",
      registry: registryWithSessions(1),
    })
    const ambiguous = () => resolveWebSocketUpgrade({
      headers: {},
      pathAndQuery: "/v1/sessions/logs",
      registry: registryWithSessions(2),
    })

    // Then
    expect(singleton.routeId).toBe(ManagedWebSocketRouteId.LOGS)
    expect(ambiguous).toThrow(AmbiguousSessionAffinityError)
  })

  it.each([
    ["/v1/sessions/pageId", ManagedWebSocketRouteId.PAGE_ID],
    ["/v1/sessions/recording", ManagedWebSocketRouteId.RECORDING],
  ] as const)("routes the pinned %s handler", (pathAndQuery, routeId) => {
    // Given
    const registry = registryWithSessions(1)

    // When
    const target = resolveWebSocketUpgrade({ headers: {}, pathAndQuery, registry })

    // Then
    expect(target).toMatchObject({ routeId, upstreamPathAndQuery: pathAndQuery })
  })

  it("rejects an unknown session, unknown route, and uncontrolled cast query", () => {
    // Given
    const registry = registryWithSessions(1)

    // When / Then
    expect(() => resolveWebSocketUpgrade({
      headers: {},
      pathAndQuery: `/?sessionId=${publicSessionId(2)}`,
      registry,
    })).toThrow(SessionNotFoundError)
    expect(() => resolveWebSocketUpgrade({
      headers: {},
      pathAndQuery: "/v1/sessions/private-handler",
      registry,
    })).toThrow(WebSocketRouteNotFoundError)
    expect(() => resolveWebSocketUpgrade({
      headers: {},
      pathAndQuery: `/v1/sessions/${publicSessionId(1)}/cast?redirect=https://attacker.invalid`,
      registry,
    })).toThrow(InvalidWebSocketQueryError)
  })
})
