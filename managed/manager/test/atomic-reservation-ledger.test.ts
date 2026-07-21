import { describe, expect, it } from "vitest"
import {
  AtomicReservationLedger,
  ReservationCapacityError,
  ReservationLedgerKind,
} from "../src/memory/atomic-reservation-ledger.js"

describe("AtomicReservationLedger", () => {
  it("admits exact byte and count capacity, then releases exactly once", () => {
    // Given
    const ledger = new AtomicReservationLedger({
      kind: ReservationLedgerKind.INGRESS_BODY,
      limitBytes: 20,
      limitCount: 2,
    })

    // When
    const first = ledger.reserve(10)
    const second = ledger.reserve(10)

    // Then
    expect(ledger.snapshot()).toEqual({
      limitBytes: 20,
      limitCount: 2,
      reservedBytes: 20,
      reservedCount: 2,
    })
    expect(() => ledger.reserve(1)).toThrowError(ReservationCapacityError)
    expect(first.release()).toBe(true)
    expect(first.release()).toBe(false)
    expect(second.release()).toBe(true)
    expect(ledger.snapshot()).toMatchObject({ reservedBytes: 0, reservedCount: 0 })
  })

  it("rejects a one-over byte reservation without mutating usage", () => {
    // Given
    const ledger = new AtomicReservationLedger({
      kind: ReservationLedgerKind.WEB_SOCKET,
      limitBytes: 16,
      limitCount: 4,
    })

    // When / Then
    expect(() => ledger.reserve(17)).toThrowError(
      expect.objectContaining({ ledger: ReservationLedgerKind.WEB_SOCKET }),
    )
    expect(ledger.snapshot()).toMatchObject({ reservedBytes: 0, reservedCount: 0 })
  })

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid reservation size %s",
    (bytes) => {
      // Given
      const ledger = new AtomicReservationLedger({
        kind: ReservationLedgerKind.ACTION,
        limitBytes: 10,
        limitCount: 1,
      })

      // When / Then
      expect(() => ledger.reserve(bytes)).toThrowError(RangeError)
    },
  )
})
