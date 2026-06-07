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
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now()
  ) {
    // Auto-cleanup expired entries every 2x windowMs to prevent memory leak
    this.cleanupTimer = setInterval(() => this.cleanup(), this.windowMs * 2);
    // Allow Node.js to exit even if timer is running
    if (this.cleanupTimer && typeof this.cleanupTimer === "object" && "unref" in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  check(key: string, limit: number): RateLimitResult {
    const currentTime = this.now();
    const existing = this.windows.get(key);

    if (!existing || existing.resetAt <= currentTime) {
      // Clean up expired entry
      if (existing && existing.resetAt <= currentTime) {
        this.windows.delete(key);
      }
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

  private cleanup() {
    const currentTime = this.now();
    for (const [key, state] of this.windows) {
      if (state.resetAt <= currentTime) {
        this.windows.delete(key);
      }
    }
  }

  clear() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.windows.clear();
  }

  get size() {
    return this.windows.size;
  }
}

export const chatRateLimiter = new FixedWindowRateLimiter(60_000);
