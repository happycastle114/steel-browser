import { describe, expect, it } from "vitest"
import {
  EventLedger,
  ReconcileOutcome,
  StaticWorkerConfigSchema,
  StaticWorkerProvider,
  WorkerHttpStatusError,
  WorkerIdSchema,
  WorkerReconciler,
  WorkerRegistry,
  WorkerRemoteState,
  type WorkerHttpClient,
} from "../src/index.js"
import { FakeClock, instanceId, upstreamSessionId, workerDescriptor } from "./test-support.js"

describe("WorkerReconciler", () => {
  it("keeps a healthy sibling available when one configured worker probe fails", async () => {
    // Given
    const clock = new FakeClock()
    const registry = new WorkerRegistry({ clock, ledger: new EventLedger({ clock }) })
    const provider = new StaticWorkerProvider(
      StaticWorkerConfigSchema.parse({
        workers: [
          { workerId: "worker-00", origin: "http://worker-00:3000" },
          { workerId: "worker-01", origin: "http://worker-01:3000" },
        ],
      }),
    )
    const client: WorkerHttpClient = {
      async probe(endpoint) {
        if (endpoint.workerId === WorkerIdSchema.parse("worker-00")) {
          throw new WorkerHttpStatusError(endpoint.workerId, 503)
        }
        return {
          worker: workerDescriptor(1, 1),
          remoteState: WorkerRemoteState.IDLE,
          sessions: [],
        }
      },
      async list(worker) {
        return { worker, remoteState: WorkerRemoteState.IDLE, sessions: [] }
      },
      async create(worker) {
        return { worker, upstreamSessionId: upstreamSessionId(999) }
      },
      async release() {},
    }

    // When
    const report = await new WorkerReconciler({ provider, client, registry }).run(
      new AbortController().signal,
    )

    // Then
    expect(report.map(({ outcome }) => outcome)).toEqual([
      ReconcileOutcome.UNREACHABLE,
      ReconcileOutcome.COMMITTED,
    ])
    expect(registry.workers()[0]?.instanceId).toBe(instanceId(1))
  })
})
