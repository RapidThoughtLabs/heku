import type { RateLimitConfig } from "./system-config.js";

// ── Sliding Window Rate Limiter ────────────────────────────────────
// Tracks request timestamps per configId in a 1-minute sliding window.
// Call check() before each request — throws if limit is exceeded.

export class RateLimiter {
  private limits: Record<string, RateLimitConfig>;
  private windows = new Map<string, number[]>();

  constructor(limits: Record<string, RateLimitConfig> = {}) {
    this.limits = limits;
  }

  /**
   * Check if a request is allowed for configId.
   * Throws with a human-readable message if rate limit is exceeded.
   * No-ops if no limit is configured for the given configId.
   */
  check(configId: string): void {
    const limit = this.limits[configId];
    if (!limit) return;

    const now = Date.now();
    const windowMs = 60_000; // 1-minute sliding window
    const max = limit.requests_per_minute;

    // Evict timestamps outside the window
    const prev = this.windows.get(configId) ?? [];
    const valid = prev.filter((t) => now - t < windowMs);

    if (valid.length >= max) {
      const oldest = valid[0];
      const retryInMs = windowMs - (now - oldest);
      const retryInSec = Math.ceil(retryInMs / 1000);
      throw new Error(
        `Rate limit exceeded for "${configId}": ${max} req/min. ` +
          `Retry in ${retryInSec}s.`,
      );
    }

    valid.push(now);
    this.windows.set(configId, valid);
  }

  /** True when at least one limit is configured. */
  hasLimits(): boolean {
    return Object.keys(this.limits).length > 0;
  }
}

// ── Module-level singleton ─────────────────────────────────────────
// Configured once at startup by cli.ts via configureLimiter().
// The executor imports getRateLimiter() and calls check() before each request.

let _limiter: RateLimiter = new RateLimiter();

export function configureLimiter(limits: Record<string, RateLimitConfig>): void {
  _limiter = new RateLimiter(limits);
}

export function getRateLimiter(): RateLimiter {
  return _limiter;
}
