export type ActionCapacitySnapshot = Readonly<{
  readonly active: number
  readonly limit: number
  readonly closed: boolean
}>

export type ActionLease = Readonly<{ readonly signal: AbortSignal }>

type ActiveLease = Readonly<{
  readonly controller: AbortController
  readonly callerSignal: AbortSignal
  readonly onCallerAbort: () => void
  readonly timeout: ReturnType<typeof setTimeout>
}>

export class ActionCapacity {
  readonly #active = new Map<ActionLease, ActiveLease>()
  readonly #limit: number
  #closed = false

  public constructor(limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new RangeError("action capacity limit must be a positive safe integer")
    }
    this.#limit = limit
  }

  public acquire(callerSignal: AbortSignal, timeoutMs: number): ActionLease | undefined {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new RangeError("action timeout must be a positive safe integer")
    }
    if (this.#closed || this.#active.size >= this.#limit) return undefined
    const controller = new AbortController()
    const lease = Object.freeze({ signal: controller.signal })
    const onCallerAbort = (): void => {
      controller.abort(callerSignal.reason)
    }
    const timeout = setTimeout(() => {
      controller.abort(new DOMException("Managed AI action timed out", "TimeoutError"))
    }, timeoutMs)
    this.#active.set(lease, { controller, callerSignal, onCallerAbort, timeout })
    callerSignal.addEventListener("abort", onCallerAbort, { once: true })
    if (callerSignal.aborted) onCallerAbort()
    return lease
  }

  public release(lease: ActionLease): boolean {
    const active = this.#active.get(lease)
    if (active === undefined) return false
    this.#active.delete(lease)
    clearTimeout(active.timeout)
    active.callerSignal.removeEventListener("abort", active.onCallerAbort)
    return true
  }

  public close(): void {
    if (this.#closed) return
    this.#closed = true
    for (const [lease, active] of [...this.#active]) {
      active.controller.abort(new DOMException("Managed AI service is closing", "AbortError"))
      this.release(lease)
    }
  }

  public snapshot(): ActionCapacitySnapshot {
    return Object.freeze({ active: this.#active.size, limit: this.#limit, closed: this.#closed })
  }
}
