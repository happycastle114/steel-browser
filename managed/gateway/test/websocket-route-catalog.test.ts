import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  PROTOCOL_KIND,
  RouteMatrixSchema,
} from "@happycastle/steel-managed-shared"
import { describe, expect, it } from "vitest"
import {
  AllocationIdSchema,
  EventLedger,
  WorkerRegistry,
  WorkerRemoteState,
} from "../src/index.js"
import {
  PUBLIC_WEBSOCKET_ROUTES,
  resolveWebSocketUpgrade,
} from "../src/websocket/upgrade-router.js"
import {
  FakeClock,
  publicSessionId,
  upstreamSessionId,
  workerDescriptor,
} from "./test-support.js"

function registryWithSession(): WorkerRegistry {
  const clock = new FakeClock()
  const registry = new WorkerRegistry({ clock, ledger: new EventLedger({ clock }) })
  const worker = workerDescriptor(0, 1)
  registry.commitObservation(registry.beginObservation(worker.workerId), {
    remoteState: WorkerRemoteState.IDLE,
    sessions: [],
    worker,
  })
  const allocationId = AllocationIdSchema.parse("allocation-ws-catalog")
  registry.reserveNext(allocationId)
  registry.bindSession({
    allocationId,
    publicSessionId: publicSessionId(1),
    upstreamSessionId: upstreamSessionId(1),
  })
  return registry
}

const WEBSOCKET_BEHAVIOR_CASES = [
  ["/v1/sessions/cast", "ws.cast"],
  ["/v1/sessions/logs", "ws.logs"],
  ["/v1/sessions/pageId", "ws.page-id"],
  ["/v1/sessions/recording", "ws.recording"],
  ["/", "ws.root-cdp"],
] as const

describe("public WebSocket route catalog", () => {
  it("equals every runtime-relevant field in the pinned five-route corpus", () => {
    // Given
    const matrixPath = fileURLToPath(new URL(
      "../../tests/upstream/c0f226b8e3b16d0bc2c76a222863d4db6f1aa8f2/route-matrix.json",
      import.meta.url,
    ))
    const matrix = RouteMatrixSchema.parse(JSON.parse(readFileSync(matrixPath, "utf8")))
    const expected = matrix.routes
      .filter((route) => route.protocol === PROTOCOL_KIND.WEBSOCKET)
      .map(({ affinity, expectedCloseCodes, id, lifecycle, path, upgradeClass }) => ({
        affinity,
        expectedCloseCodes,
        id,
        lifecycle,
        path,
        upgradeClass,
      }))
      .sort((left, right) => left.id.localeCompare(right.id))

    // When
    const actual = [...PUBLIC_WEBSOCKET_ROUTES].sort((left, right) => left.id.localeCompare(right.id))

    // Then
    expect(actual).toEqual(expected)
  })

  it.each(WEBSOCKET_BEHAVIOR_CASES)("routes %s to %s", (pathAndQuery, routeId) => {
    // Given
    const registry = registryWithSession()

    // When
    const target = resolveWebSocketUpgrade({ headers: {}, pathAndQuery, registry })

    // Then
    expect(target.routeId).toBe(routeId)
    expect(target.worker.workerId).toBe("worker-00")
  })
})
