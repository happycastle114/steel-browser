import {
  WorkerState,
  type WorkerState as WorkerStateValue,
} from "@happycastle/steel-managed-gateway"
import type { RuntimeHealth } from "../health/runtime-health.js"

type ReconcilerPort = Readonly<{
  run(signal: AbortSignal): Promise<unknown>
}>

type RegistryPort = Readonly<{
  workers(): readonly Readonly<{ state: WorkerStateValue }>[]
}>

type AdmissionProcessorPort = Readonly<{
  processNext(signal: AbortSignal): Promise<unknown | undefined>
}>

type ReconciliationLoopOptions = Readonly<{
  admissions: AdmissionProcessorPort
  health: RuntimeHealth
  intervalMilliseconds: number
  onError: (error: unknown) => void
  reconciler: ReconcilerPort
  registry: RegistryPort
}>

export class ReconciliationLoop {
  private readonly controller = new AbortController()
  private cycle: Promise<void> | undefined
  private timer: NodeJS.Timeout | undefined

  public constructor(private readonly options: ReconciliationLoopOptions) {
    if (!Number.isSafeInteger(options.intervalMilliseconds) || options.intervalMilliseconds < 1) {
      throw new RangeError("reconciliation interval must be positive")
    }
  }

  public start(): void {
    if (this.timer !== undefined || this.controller.signal.aborted) return
    this.timer = setTimeout(() => this.beginCycle(), 0)
  }

  public async runNow(): Promise<void> {
    if (this.controller.signal.aborted) return
    if (this.cycle !== undefined) return this.cycle
    const task = this.reconcileAndAdmit()
    this.cycle = task
    try {
      await task
    } finally {
      if (this.cycle === task) this.cycle = undefined
    }
  }

  public async stop(): Promise<void> {
    this.controller.abort()
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    await this.cycle
  }

  private beginCycle(): void {
    this.timer = undefined
    void this.runNow().finally(() => {
      if (this.controller.signal.aborted) return
      this.timer = setTimeout(() => this.beginCycle(), this.options.intervalMilliseconds)
    })
  }

  private async reconcileAndAdmit(): Promise<void> {
    try {
      await this.options.reconciler.run(this.controller.signal)
      const workers = this.options.registry.workers()
      this.options.health.recordReconciliation(workers.some(workerIsReachable))
      for (let index = 0; index < workers.length; index += 1) {
        if ((await this.options.admissions.processNext(this.controller.signal)) === undefined) break
      }
    } catch (error) {
      if (this.controller.signal.aborted) return
      this.options.health.recordReconciliation(false)
      this.options.onError(error)
    }
  }
}

function workerIsReachable(worker: Readonly<{ state: WorkerStateValue }>): boolean {
  switch (worker.state) {
    case WorkerState.IDLE:
    case WorkerState.RESERVED:
    case WorkerState.LIVE:
    case WorkerState.RELEASING:
    case WorkerState.RELEASE_UNCERTAIN:
      return true
    case WorkerState.RELEASE_UNCERTAIN_UNREACHABLE:
    case WorkerState.UNREACHABLE:
    case WorkerState.QUARANTINED:
      return false
    default:
      return unreachableWorkerState(worker.state)
  }
}

function unreachableWorkerState(state: never): never {
  throw new RangeError(`unreachable worker state: ${String(state)}`)
}
