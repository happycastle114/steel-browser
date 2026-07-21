export const ReadinessState = {
  NOT_INITIALIZED: "NOT_INITIALIZED",
  READY: "READY",
  RECONCILE_GRACE: "RECONCILE_GRACE",
  STOPPING: "STOPPING",
  UNREACHABLE: "UNREACHABLE",
  WAITING_FOR_RECONCILE: "WAITING_FOR_RECONCILE",
} as const
export type ReadinessState = (typeof ReadinessState)[keyof typeof ReadinessState]

export type RuntimeHealthSnapshot = Readonly<{
  live: true
  ready: boolean
  readiness: ReadinessState
  consecutiveUnreachableIntervals: number
}>

const FAILED_INTERVAL_LIMIT = 3

export class RuntimeHealth {
  private consecutiveUnreachableIntervals = 0
  private initialized = false
  private observedReachable = false
  private reconciled = false
  private stopping = false

  public markInitialized(): void {
    this.initialized = true
  }

  public recordReconciliation(hasReachableWorker: boolean): void {
    this.reconciled = true
    if (hasReachableWorker) {
      this.observedReachable = true
      this.consecutiveUnreachableIntervals = 0
      return
    }
    this.consecutiveUnreachableIntervals += 1
  }

  public markStopping(): void {
    this.stopping = true
  }

  public snapshot(): RuntimeHealthSnapshot {
    const readiness = this.readinessState()
    return {
      live: true,
      ready:
        readiness === ReadinessState.READY || readiness === ReadinessState.RECONCILE_GRACE,
      readiness,
      consecutiveUnreachableIntervals: this.consecutiveUnreachableIntervals,
    }
  }

  private readinessState(): ReadinessState {
    if (this.stopping) return ReadinessState.STOPPING
    if (!this.initialized) return ReadinessState.NOT_INITIALIZED
    if (!this.reconciled) return ReadinessState.WAITING_FOR_RECONCILE
    if (this.consecutiveUnreachableIntervals === 0) return ReadinessState.READY
    if (
      this.observedReachable &&
      this.consecutiveUnreachableIntervals < FAILED_INTERVAL_LIMIT
    ) {
      return ReadinessState.RECONCILE_GRACE
    }
    return ReadinessState.UNREACHABLE
  }
}
