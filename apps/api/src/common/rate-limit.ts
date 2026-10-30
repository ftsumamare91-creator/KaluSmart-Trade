import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Fixed-window limiter kept in memory (one process). The map is bounded, so a flood of
 * distinct keys cannot exhaust memory. With several API instances, move this to a shared store.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly limit: number, private readonly windowMs: number, private readonly maxKeys = 50_000) {}

  consume(key: string, now = Date.now()): void {
    const current = this.hits.get(key);
    if (!current || current.resetAt <= now) {
      if (!this.hits.has(key) && this.hits.size >= this.maxKeys) this.prune(now);
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    current.count += 1;
    if (current.count > this.limit) {
      throw new HttpException({ statusCode: 429, message: 'Too many requests. Try again shortly.' }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private prune(now: number): void {
    for (const [key, value] of this.hits) if (value.resetAt <= now) this.hits.delete(key);
    if (this.hits.size >= this.maxKeys) this.hits.clear();
  }
}

/** Failed-login lockout: none before MAX_FAILS, then 30 s doubling per extra failure, capped at 15 min. Temporary only. */
export const MAX_FAILS = 5;
export const FAIL_WINDOW_MS = 15 * 60_000;
export function lockoutMs(failCount: number): number {
  if (failCount < MAX_FAILS) return 0;
  const step = Math.min(failCount - MAX_FAILS, 10);
  return Math.min(30_000 * 2 ** step, 15 * 60_000);
}
