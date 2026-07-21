import { describe, expect, it } from "vitest"

import { ActionCapacity } from "../src/api/managed/action-capacity.js"

describe("managed AI action capacity", () => {
  it("admits only the configured number of active actions", () => {
    const subject = new ActionCapacity(1)

    const first = subject.acquire(new AbortController().signal, 30_000)
    const blocked = subject.acquire(new AbortController().signal, 30_000)

    expect(first?.signal.aborted).toBe(false)
    expect(blocked).toBeUndefined()
    expect(subject.snapshot()).toEqual({ active: 1, limit: 1, closed: false })
  })

  it("releases one lease exactly once", () => {
    const subject = new ActionCapacity(1)
    const lease = subject.acquire(new AbortController().signal, 30_000)
    if (lease === undefined) throw new TypeError("test lease was not admitted")

    expect(subject.release(lease)).toBe(true)
    expect(subject.release(lease)).toBe(false)
    expect(subject.snapshot()).toEqual({ active: 0, limit: 1, closed: false })
  })

  it("propagates caller cancellation without admitting overlapping work", () => {
    const caller = new AbortController()
    const subject = new ActionCapacity(1)
    const lease = subject.acquire(caller.signal, 30_000)
    if (lease === undefined) throw new TypeError("test lease was not admitted")

    caller.abort(new Error("client disconnected"))

    expect(lease.signal.aborted).toBe(true)
    expect(subject.snapshot().active).toBe(1)
    expect(subject.acquire(new AbortController().signal, 30_000)).toBeUndefined()
    expect(subject.release(lease)).toBe(true)
  })

  it("aborts every active action and rejects new work after close", () => {
    const subject = new ActionCapacity(2)
    const first = subject.acquire(new AbortController().signal, 30_000)
    const second = subject.acquire(new AbortController().signal, 30_000)
    if (first === undefined || second === undefined) throw new TypeError("test leases were not admitted")

    subject.close()

    expect([first.signal.aborted, second.signal.aborted]).toEqual([true, true])
    expect(subject.acquire(new AbortController().signal, 30_000)).toBeUndefined()
    expect(subject.snapshot()).toEqual({ active: 0, limit: 2, closed: true })
  })
})
