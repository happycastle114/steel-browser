import {
  RESULT_RESERVATION_STATE,
  type ReservationEntry,
  type ResultCapacityExhaustion,
  type ResultReservationSnapshot,
} from "./result-reservation-contract.js"

export function projectResultReservationSnapshot(
  entries: Iterable<Readonly<ReservationEntry>>,
): ResultReservationSnapshot {
  let inFlightBytes = 0
  let inFlightCount = 0
  let retainedBytes = 0
  let retainedCount = 0
  let earliestRetainedExpiresAtMs: number | undefined
  for (const entry of entries) {
    switch (entry.state) {
      case RESULT_RESERVATION_STATE.IN_FLIGHT:
      case RESULT_RESERVATION_STATE.PREPARED:
        inFlightBytes += entry.reservedBytes
        inFlightCount += 1
        break
      case RESULT_RESERVATION_STATE.RETAINED:
        retainedBytes += entry.reservedBytes
        retainedCount += 1
        earliestRetainedExpiresAtMs = earliestRetainedExpiresAtMs === undefined
          ? entry.expiresAtMs
          : Math.min(earliestRetainedExpiresAtMs, entry.expiresAtMs)
        break
    }
  }
  return {
    reservedBytes: inFlightBytes + retainedBytes,
    reservedCount: inFlightCount + retainedCount,
    inFlightBytes,
    inFlightCount,
    retainedBytes,
    retainedCount,
    ...(earliestRetainedExpiresAtMs === undefined ? {} : { earliestRetainedExpiresAtMs }),
  }
}

export function resultCapacityExhaustion(snapshot: ResultReservationSnapshot): ResultCapacityExhaustion {
  if (snapshot.inFlightCount > 0) return { state: RESULT_RESERVATION_STATE.IN_FLIGHT }
  if (snapshot.earliestRetainedExpiresAtMs === undefined) {
    throw new RangeError("capacity exhaustion requires an in-flight or retained reservation")
  }
  return {
    state: RESULT_RESERVATION_STATE.RETAINED,
    earliestRetainedExpiresAtMs: snapshot.earliestRetainedExpiresAtMs,
  }
}
