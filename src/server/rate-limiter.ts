import { config } from "./config.js";

export type RateLimitResult =
  | { allowed: true; remaining: number; resetAt: number }
  | { allowed: false; remaining: 0; resetAt: number; retryAfterSeconds: number };

type WindowState = {
  count: number;
  resetAt: number;
};

export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, WindowState>();

  constructor(
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now()
  ) {}

  check(key: string, limit: number): RateLimitResult {
    const currentTime = this.now();
    const existing = this.windows.get(key);

    if (!existing || existing.resetAt <= currentTime) {
      const resetAt = currentTime + this.windowMs;
      this.windows.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: limit - 1, resetAt };
    }

    if (existing.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: existing.resetAt,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - currentTime) / 1000))
      };
    }

    existing.count += 1;
    return { allowed: true, remaining: limit - existing.count, resetAt: existing.resetAt };
  }

  clear() {
    this.windows.clear();
  }
}

export const chatRateLimiter = new FixedWindowRateLimiter(60_000);
