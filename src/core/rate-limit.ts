/** How many calls may pass per key, within a sliding window. */
export interface RateLimitConfig {
  count: number;
  windowMs: number;
}

/**
 * A simple sliding-window rate limiter, in-memory and per-key. The wallet uses
 * it to throttle authenticated agents — a chatty agent cannot DOS the approval
 * queue or burn rails by spamming `pay()`. State lives in process memory, so
 * a restart resets the window (which an attacker cannot trigger).
 */
export class RateLimiter {
  private readonly count: number;
  private readonly windowMs: number;
  private readonly buckets = new Map<string, number[]>();

  constructor(config: RateLimitConfig) {
    this.count = config.count;
    this.windowMs = config.windowMs;
  }

  /**
   * Try to admit a call for `key`. Returns true if it fits in the window,
   * false if the key has already hit its limit.
   */
  admit(key: string, now: number = Date.now()): boolean {
    const horizon = now - this.windowMs;
    const recent = (this.buckets.get(key) ?? []).filter((t) => t > horizon);
    if (recent.length >= this.count) {
      this.buckets.set(key, recent);
      return false;
    }
    recent.push(now);
    this.buckets.set(key, recent);
    return true;
  }
}
