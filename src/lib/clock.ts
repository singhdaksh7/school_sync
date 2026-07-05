/**
 * Narrow, injectable time source for Cost Guard services (PART 30). Session
 * expiry, rolling login-quota windows, failed-password escalation cooldowns,
 * and file-retention expiry all need deterministic tests — real `setTimeout`
 * sleeps for a 6-hour lock or a 30-day expiry are not viable. Every Cost
 * Guard service takes `now: Date` as an explicit parameter (defaulting to
 * `clock.now()`) instead of calling `new Date()` internally, so tests can
 * pass a fixed/advancing Date without any global monkey-patching.
 */

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** Test-only clock that starts at a fixed instant and only moves when explicitly advanced. */
export class FixedClock implements Clock {
  private current: Date;

  constructor(start: Date) {
    this.current = start;
  }

  now(): Date {
    return this.current;
  }

  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  set(date: Date): void {
    this.current = date;
  }
}
