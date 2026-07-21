export const ReservationLedgerKind = {
  ACTION: "ACTION",
  INGRESS_BODY: "INGRESS_BODY",
  INGRESS_CONNECTION: "INGRESS_CONNECTION",
  RESULT: "RESULT",
  WEB_SOCKET: "WEB_SOCKET",
} as const
export type ReservationLedgerKind =
  (typeof ReservationLedgerKind)[keyof typeof ReservationLedgerKind]

export type ReservationLedgerSnapshot = Readonly<{
  limitBytes: number
  limitCount: number
  reservedBytes: number
  reservedCount: number
}>

export class ReservationCapacityError extends Error {
  public override readonly name = "ReservationCapacityError"

  public constructor(public readonly ledger: ReservationLedgerKind) {
    super("reservation capacity exhausted")
  }
}

export class ReservationLease {
  private active = true

  public constructor(private readonly releaseReservation: () => void) {}

  public release(): boolean {
    if (!this.active) return false
    this.active = false
    this.releaseReservation()
    return true
  }
}

type AtomicReservationLedgerOptions = Readonly<{
  kind: ReservationLedgerKind
  limitBytes: number
  limitCount: number
}>

export class AtomicReservationLedger {
  private reservedBytes = 0
  private reservedCount = 0
  private readonly kind: ReservationLedgerKind
  private readonly limitBytes: number
  private readonly limitCount: number

  public constructor(options: AtomicReservationLedgerOptions) {
    requirePositiveSafeInteger(options.limitBytes, "byte limit")
    requirePositiveSafeInteger(options.limitCount, "count limit")
    this.kind = options.kind
    this.limitBytes = options.limitBytes
    this.limitCount = options.limitCount
  }

  public reserve(bytes: number): ReservationLease {
    requirePositiveSafeInteger(bytes, "reservation bytes")
    if (
      this.reservedCount + 1 > this.limitCount ||
      this.reservedBytes + bytes > this.limitBytes
    ) {
      throw new ReservationCapacityError(this.kind)
    }
    this.reservedCount += 1
    this.reservedBytes += bytes
    return new ReservationLease(() => {
      this.reservedCount -= 1
      this.reservedBytes -= bytes
    })
  }

  public snapshot(): ReservationLedgerSnapshot {
    return {
      limitBytes: this.limitBytes,
      limitCount: this.limitCount,
      reservedBytes: this.reservedBytes,
      reservedCount: this.reservedCount,
    }
  }
}

function requirePositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be positive`)
}
