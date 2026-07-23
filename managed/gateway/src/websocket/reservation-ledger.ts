import {
  CONTROL_PLANE_FIXED,
  deriveWebSocketReservationBytes,
} from "@happycastle/steel-managed-shared"
import { z } from "zod"

export const WEB_SOCKET_FIXED_OVERHEAD_BYTES = CONTROL_PLANE_FIXED.webSocketOverheadBytes

const ReservationOptionsSchema = z
  .object({
    bufferBytes: z.number().int().positive().safe(),
    limitBytes: z.number().int().positive().safe(),
    limitCount: z.number().int().positive().safe(),
    messageBytes: z.number().int().positive().safe(),
  })
  .strict()
  .readonly()

type ReservationOptions = z.infer<typeof ReservationOptionsSchema>

export type WebSocketReservationLease = {
  readonly release: () => boolean
  readonly reservationBytes: number
}

export type WebSocketReservationSnapshot = {
  readonly activeCount: number
  readonly limitBytes: number
  readonly limitCount: number
  readonly reservationBytes: number
  readonly reservedBytes: number
}

export class WebSocketReservationLedger {
  private activeCount = 0
  private reservedBytes = 0
  private readonly limitBytes: number
  private readonly limitCount: number
  private readonly reservationBytes: number

  public constructor(input: ReservationOptions) {
    const options = ReservationOptionsSchema.parse(input)
    this.limitBytes = options.limitBytes
    this.limitCount = options.limitCount
    this.reservationBytes = deriveWebSocketReservationBytes({
      messageBytes: options.messageBytes,
      bufferBytes: options.bufferBytes,
    })
  }

  public tryReserve(): WebSocketReservationLease | undefined {
    if (
      this.activeCount >= this.limitCount ||
      this.reservedBytes + this.reservationBytes > this.limitBytes
    ) {
      return undefined
    }
    this.activeCount += 1
    this.reservedBytes += this.reservationBytes
    let released = false
    return {
      reservationBytes: this.reservationBytes,
      release: () => {
        if (released) return false
        released = true
        this.activeCount -= 1
        this.reservedBytes -= this.reservationBytes
        return true
      },
    }
  }

  public snapshot(): WebSocketReservationSnapshot {
    return {
      activeCount: this.activeCount,
      limitBytes: this.limitBytes,
      limitCount: this.limitCount,
      reservationBytes: this.reservationBytes,
      reservedBytes: this.reservedBytes,
    }
  }
}
