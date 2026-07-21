import { describe, expect, it } from "vitest"
import { WebSocketReservationLedger } from "../src/websocket/duplex-proxy.js"

describe("WebSocketReservationLedger", () => {
  it("reserves both directional message and queue budgets plus fixed overhead", () => {
    // Given
    const messageBytes = 64
    const bufferBytes = 128
    const reservationBytes = 1_048_960
    const ledger = new WebSocketReservationLedger({
      bufferBytes,
      limitBytes: reservationBytes * 2,
      limitCount: 2,
      messageBytes,
    })

    // When
    const first = ledger.tryReserve()
    const second = ledger.tryReserve()
    const rejected = ledger.tryReserve()

    // Then
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(rejected).toBeUndefined()
    expect(ledger.snapshot()).toEqual({
      activeCount: 2,
      limitBytes: reservationBytes * 2,
      limitCount: 2,
      reservationBytes,
      reservedBytes: reservationBytes * 2,
    })
  })

  it("releases a reservation once and makes capacity reusable", () => {
    // Given
    const ledger = new WebSocketReservationLedger({
      bufferBytes: 128,
      limitBytes: 1_048_960,
      limitCount: 1,
      messageBytes: 64,
    })
    const lease = ledger.tryReserve()
    if (lease === undefined) throw new TypeError("expected an initial reservation")

    // When
    const firstRelease = lease.release()
    const secondRelease = lease.release()
    const replacement = ledger.tryReserve()

    // Then
    expect(firstRelease).toBe(true)
    expect(secondRelease).toBe(false)
    expect(replacement).toBeDefined()
    expect(ledger.snapshot().activeCount).toBe(1)
  })
})
