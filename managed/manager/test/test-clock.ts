import type { Clock } from "../src/clock.js"

export class MutableClock implements Clock {
  public constructor(private milliseconds: number) {}

  public nowMilliseconds(): number {
    return this.milliseconds
  }

  public advance(milliseconds: number): void {
    this.milliseconds += milliseconds
  }
}
