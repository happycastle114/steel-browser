export interface Clock {
  nowMilliseconds(): number
}

export class SystemClock implements Clock {
  public nowMilliseconds(): number {
    return Date.now()
  }
}
