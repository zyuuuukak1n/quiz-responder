import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  SlidingWindowRateLimiter,
  MultiTierRateLimiter,
} from "../lib/rateLimiter";

describe("rateLimiter.ts - スライディングウィンドウ型レートリミット", () => {
  let limiter: SlidingWindowRateLimiter;

  beforeEach(() => {
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

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(shortLimiter.check(ip).allowed).toBe(true);
  });
});

describe("rateLimiter.ts - MultiTierRateLimiter (多段階防壁・In-Flight排他・重複キャッシュ)", () => {
  let multiLimiter: MultiTierRateLimiter;

  beforeEach(() => {
    multiLimiter = new MultiTierRateLimiter([
      { name: "burst", windowMs: 200, maxRequests: 2 },
      { name: "minute", windowMs: 1000, maxRequests: 5 },
    ]);
  });

  it("多段階Tierで短期バーストを検出して遮断すること", () => {
    const ip = "1.2.3.4";
    expect(multiLimiter.check(ip).allowed).toBe(true);
    expect(multiLimiter.check(ip).allowed).toBe(true);
    // burst上限（2回）到達
    const third = multiLimiter.check(ip);
    expect(third.allowed).toBe(false);
    expect(third.reason).toContain("burst");
  });

  it("In-Flight排他制御により同一IPの同時並行リクエストを遮断できること", () => {
    const ip = "5.6.7.8";
    expect(multiLimiter.acquireInFlight(ip)).toBe(true);
    // 処理中に別リクエストが来た場合は排他遮断
    expect(multiLimiter.acquireInFlight(ip)).toBe(false);

    // 解放後は再度取得可能
    multiLimiter.releaseInFlight(ip);
    expect(multiLimiter.acquireInFlight(ip)).toBe(true);
    multiLimiter.releaseInFlight(ip);
  });

  it("同一リクエストの回答キャッシュを保存・取得し、有効期限切れで無効化されること", async () => {
    const key = "test_key_123";
    const chunks = ["【1】 青\n", "根拠解説"];

    expect(multiLimiter.getCachedAnswer(key)).toBeNull();

    // 50msのTTLでキャッシュ保存
    multiLimiter.setCachedAnswer(key, chunks, 50);
    expect(multiLimiter.getCachedAnswer(key)).toEqual(chunks);

    // 60ms待機
    await new Promise((r) => setTimeout(r, 60));
    expect(multiLimiter.getCachedAnswer(key)).toBeNull();
  });
});
