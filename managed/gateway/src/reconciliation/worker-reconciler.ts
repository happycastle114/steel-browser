import { WorkerAdapterError } from "../domain/errors.js"
import { assertNever } from "../domain/exhaustive.js"
import type { WorkerId } from "../domain/ids.js"
import {
  ObservationCommitKind,
  ReconcileOutcome,
  type ReconcileOutcome as ReconcileOutcomeValue,
} from "../domain/states.js"
import type { WorkerRegistry } from "../registry/worker-registry.js"
import type { WorkerHttpClient } from "../worker/worker-http-contract.js"
import type { WorkerProvider, StaticWorkerEndpoint } from "../worker/static-worker-provider.js"

type WorkerReconcilerOptions = {
  readonly provider: WorkerProvider
  readonly client: WorkerHttpClient
  readonly registry: WorkerRegistry
}

export type ReconcileReportEntry = {
  readonly workerId: WorkerId
  readonly outcome: ReconcileOutcomeValue
}

export class WorkerReconciler {
  private readonly provider: WorkerProvider
  private readonly client: WorkerHttpClient
  private readonly registry: WorkerRegistry

  public constructor(options: WorkerReconcilerOptions) {
    this.provider = options.provider
    this.client = options.client
    this.registry = options.registry
  }

  public async run(signal: AbortSignal): Promise<readonly ReconcileReportEntry[]> {
    const report: ReconcileReportEntry[] = []
    for (const endpoint of this.provider.list()) {
      report.push(await this.reconcile(endpoint, signal))
    }
    return report
  }

  private async reconcile(
    endpoint: StaticWorkerEndpoint,
    signal: AbortSignal,
  ): Promise<ReconcileReportEntry> {
    const observation = this.registry.beginObservation(endpoint.workerId)
    try {
      const probe = await this.client.probe(endpoint, signal)
      const committed = this.registry.commitObservation(observation, {
        worker: probe.worker,
        remoteState: probe.remoteState,
        sessions: probe.sessions,
      })
      return {
        workerId: endpoint.workerId,
        outcome: this.outcomeForCommit(committed.kind),
      }
    } catch (error) {
      if (error instanceof WorkerAdapterError) {
        if (signal.aborted) throw error
        const committed = this.registry.commitUnreachable(observation)
        return {
          workerId: endpoint.workerId,
          outcome: committed ? ReconcileOutcome.UNREACHABLE : ReconcileOutcome.STALE,
        }
      }
      throw error
    }
  }

  private outcomeForCommit(kind: ObservationCommitKind): ReconcileOutcomeValue {
    switch (kind) {
      case ObservationCommitKind.COMMITTED:
        return ReconcileOutcome.COMMITTED
      case ObservationCommitKind.STALE_OBSERVATION:
        return ReconcileOutcome.STALE
      default:
        return assertNever(kind)
    }
  }
}
