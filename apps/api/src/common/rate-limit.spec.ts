import { RateLimiter, lockoutMs, MAX_FAILS } from './rate-limit';

describe('RateLimiter', () => {
  it('allows up to the limit, then rejects with 429', () => {
    const limiter = new RateLimiter(3, 60_000);
    limiter.consume('ip', 0);
    limiter.consume('ip', 1);
    limiter.consume('ip', 2);
    expect(() => limiter.consume('ip', 3)).toThrow();
  });

  it('resets after the window passes', () => {
    const limiter = new RateLimiter(1, 1_000);
    limiter.consume('ip', 0);
    expect(() => limiter.consume('ip', 500)).toThrow();
    expect(() => limiter.consume('ip', 2_000)).not.toThrow();
  });

  it('keeps different keys separate', () => {
    const limiter = new RateLimiter(1, 60_000);
    limiter.consume('a', 0);
    expect(() => limiter.consume('b', 0)).not.toThrow();
  });
});

describe('lockoutMs', () => {
  it('does not lock before the threshold', () => {
    expect(lockoutMs(MAX_FAILS - 1)).toBe(0);
  });
  it('starts at 30 seconds and doubles', () => {
    expect(lockoutMs(MAX_FAILS)).toBe(30_000);
    expect(lockoutMs(MAX_FAILS + 1)).toBe(60_000);
  });
  it('is capped at 15 minutes (temporary, never permanent)', () => {
    expect(lockoutMs(100)).toBe(15 * 60_000);
  });
});
