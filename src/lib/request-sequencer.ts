/**
 * Minimal token-based guard against out-of-order async responses: each fetch
 * cycle claims a token via `next()`, and only the response whose token still
 * equals the sequencer's `current` when it resolves is allowed to update
 * state — a slower, now-stale request can never win a race against a faster,
 * newer one. Used by SmartTimetableWorkspace's class/section subject +
 * requirements fetch.
 */
export function createRequestSequencer() {
  let current = 0;
  return {
    next(): number {
      current += 1;
      return current;
    },
    isCurrent(token: number): boolean {
      return token === current;
    },
  };
}
