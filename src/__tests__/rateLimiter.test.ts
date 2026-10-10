import { describe, it, expect, beforeEach, vi } from "vitest";
import { SlidingWindowRateLimiter } from "../lib/rateLimiter";

describe("rateLimiter.ts - スライディングウィンドウ型レートリミット", () => {
  let limiter: SlidingWindowRateLimiter;

  beforeEach(() => {
    // 1000msのウィンドウに最大3回
    limiter = new SlidingWindowRateLimiter({
      windowMs: 1000,
      maxRequests: 3,
      cleanupIntervalMs: 500,
    });
    vi.useRealTimers();
  });

  it("上限回数内のリクエストを許可すること", () => {
    const ip = "192.168.1.10";
    expect(limiter.check(ip).allowed).toBe(true);
    expect(limiter.check(ip).allowed).toBe(true);
    expect(limiter.check(ip).allowed).toBe(true);
  });

  it("上限回数（3回）を超えたリクエストを遮断すること", () => {
    const ip = "192.168.1.20";
    limiter.check(ip);
    limiter.check(ip);
    limiter.check(ip);

    const fourth = limiter.check(ip);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.resetTimeMs).toBeGreaterThan(Date.now());
  });

  it("別々のIPアドレスは独立して制限されること", () => {
    const ipA = "10.0.0.1";
    const ipB = "10.0.0.2";

    limiter.check(ipA);
    limiter.check(ipA);
    limiter.check(ipA);
    expect(limiter.check(ipA).allowed).toBe(false);

    // ipBはまだ0回なので許可される
    expect(limiter.check(ipB).allowed).toBe(true);
  });

  it("ウィンドウ時間経過後は再びリクエストが可能になること", async () => {
    const shortLimiter = new SlidingWindowRateLimiter({
      windowMs: 50,
      maxRequests: 2,
    });
    const ip = "172.16.0.5";

    expect(shortLimiter.check(ip).allowed).toBe(true);
    expect(shortLimiter.check(ip).allowed).toBe(true);
    expect(shortLimiter.check(ip).allowed).toBe(false);

    // 60ms待機してウィンドウを越えさせる
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(shortLimiter.check(ip).allowed).toBe(true);
  });
});
