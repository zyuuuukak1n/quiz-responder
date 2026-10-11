/**
 * 多段階レートリミッター & API浪費防御モジュール
 *
 * 1. 多段階スライディングウィンドウ（10秒バースト / 60秒中期 / 1時間長期）
 * 2. 同一IPの同時実行排他制御（In-Flight Lock: 過剰な並行リクエストによる課金爆発防止）
 * 3. 短期キャッシュ（Deduplication Cache: 同一出題の連打・重複呼び出しによるAPI浪費防止）
 */

export interface RateLimitOptions {
  windowMs: number; // ウィンドウ時間 (ミリ秒)
  maxRequests: number; // ウィンドウ内の最大許容リクエスト数
  cleanupIntervalMs?: number; // 期限切れエントリの削除間隔
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTimeMs: number;
  reason?: string;
}

/**
 * 単一ウィンドウ用スライディングウィンドウ・レートリミッター（後方互換性維持）
 */
export class SlidingWindowRateLimiter {
  private requests: Map<string, number[]> = new Map();
  private windowMs: number;
  private maxRequests: number;
  private lastCleanup: number = Date.now();
  private cleanupIntervalMs: number;

  constructor(options: RateLimitOptions) {
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? 60_000;
  }

  public check(ip: string): RateLimitResult {
    const now = Date.now();
    this.maybeCleanup(now);

    const timestamps = this.requests.get(ip) || [];
    const windowStart = now - this.windowMs;

    const validTimestamps = timestamps.filter((t) => t > windowStart);

    if (validTimestamps.length >= this.maxRequests) {
      const oldest = validTimestamps[0];
      const resetTimeMs = oldest + this.windowMs;
      return {
        allowed: false,
        remaining: 0,
        resetTimeMs,
      };
    }

    validTimestamps.push(now);
    this.requests.set(ip, validTimestamps);

    return {
      allowed: true,
      remaining: this.maxRequests - validTimestamps.length,
      resetTimeMs: now + this.windowMs,
    };
  }

  public reset(): void {
    this.requests.clear();
    this.lastCleanup = Date.now();
  }

  private maybeCleanup(now: number): void {
    if (now - this.lastCleanup < this.cleanupIntervalMs) {
      return;
    }
    this.lastCleanup = now;
    const windowStart = now - this.windowMs;

    for (const [ip, timestamps] of this.requests.entries()) {
      const remaining = timestamps.filter((t) => t > windowStart);
      if (remaining.length === 0) {
        this.requests.delete(ip);
      } else {
        this.requests.set(ip, remaining);
      }
    }
  }
}

/**
 * 多段階レートリミッター設定
 */
export interface MultiTierTier {
  name: string;
  windowMs: number;
  maxRequests: number;
}

export class MultiTierRateLimiter {
  private tiers: MultiTierTier[];
  private limiters: Map<string, SlidingWindowRateLimiter> = new Map();
  private inFlightLocks: Set<string> = new Set(); // 実行中リクエストのIPセット
  private responseCache: Map<string, { chunks: string[]; expiresAt: number }> =
    new Map();

  constructor(tiers?: MultiTierTier[]) {
    this.tiers = tiers ?? [
      { name: "short_burst", windowMs: 10_000, maxRequests: 4 }, // 10秒に4回まで
      { name: "standard_minute", windowMs: 60_000, maxRequests: 15 }, // 60秒に15回まで
      { name: "hourly_protection", windowMs: 3_600_000, maxRequests: 80 }, // 1時間に80回まで
    ];

    for (const tier of this.tiers) {
      this.limiters.set(
        tier.name,
        new SlidingWindowRateLimiter({
          windowMs: tier.windowMs,
          maxRequests: tier.maxRequests,
        })
      );
    }
  }

  /**
   * 全てのTierでレート制限を判定します。
   */
  public check(ip: string): RateLimitResult {
    let minRemaining = Infinity;
    let maxResetTime = 0;

    for (const tier of this.tiers) {
      const limiter = this.limiters.get(tier.name);
      if (!limiter) continue;

      const res = limiter.check(ip);
      if (!res.allowed) {
        return {
          allowed: false,
          remaining: 0,
          resetTimeMs: res.resetTimeMs,
          reason: `${tier.name} リミット超過（${tier.windowMs / 1000}秒間に最大${tier.maxRequests}回）`,
        };
      }

      if (res.remaining < minRemaining) {
        minRemaining = res.remaining;
      }
      if (res.resetTimeMs > maxResetTime) {
        maxResetTime = res.resetTimeMs;
      }
    }

    return {
      allowed: true,
      remaining: minRemaining === Infinity ? 0 : minRemaining,
      resetTimeMs: maxResetTime || Date.now() + 60_000,
    };
  }

  /**
   * 同一IPでの同時実行（In-Flight）ロックを取得します。
   */
  public acquireInFlight(ip: string): boolean {
    if (this.inFlightLocks.has(ip)) {
      return false; // 既に処理中
    }
    this.inFlightLocks.add(ip);
    return true;
  }

  /**
   * 同一IPの同時実行ロックを解放します。
   */
  public releaseInFlight(ip: string): void {
    this.inFlightLocks.delete(ip);
  }

  /**
   * 重複リクエストキャッシュの取得
   */
  public getCachedAnswer(hashKey: string): string[] | null {
    const item = this.responseCache.get(hashKey);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.responseCache.delete(hashKey);
      return null;
    }
    return item.chunks;
  }

  /**
   * 重複リクエストキャッシュの保存（デフォルト20秒間）
   */
  public setCachedAnswer(
    hashKey: string,
    chunks: string[],
    ttlMs: number = 20_000
  ): void {
    this.responseCache.set(hashKey, {
      chunks,
      expiresAt: Date.now() + ttlMs,
    });

    // 肥大化防止の簡易クリーンアップ
    if (this.responseCache.size > 200) {
      const now = Date.now();
      for (const [k, v] of this.responseCache.entries()) {
        if (now > v.expiresAt) {
          this.responseCache.delete(k);
        }
      }
    }
  }

  /**
   * テスト用リセット
   */
  public reset(): void {
    for (const limiter of this.limiters.values()) {
      limiter.reset();
    }
    this.inFlightLocks.clear();
    this.responseCache.clear();
  }
}

// 多段階レートリミッターのシングルトンインスタンス
export const defaultRateLimiter = new MultiTierRateLimiter();
