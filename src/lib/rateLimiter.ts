/**
 * IPベースのスライディングウィンドウ・レートリミッター
 * 短時間での過剰なLLM API呼び出しやDDoS・クラウド課金爆発を未然に防止します。
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
}

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

  /**
   * クライアントIPをチェックし、レートリミットを判定します。
   */
  public check(ip: string): RateLimitResult {
    const now = Date.now();
    this.maybeCleanup(now);

    const timestamps = this.requests.get(ip) || [];
    const windowStart = now - this.windowMs;

    // 現在のウィンドウ内にあるタイムスタンプのみ残す
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

  /**
   * テスト用またはメンテ用にキャッシュをリセットします。
   */
  public reset(): void {
    this.requests.clear();
    this.lastCleanup = Date.now();
  }

  /**
   * メモリ肥大化を防ぐため、期限切れIPレコードを一括消去します。
   */
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

// デフォルトインスタンス: 60秒間に最大15リクエスト（実利用で快適かつ過剰アクセスを防御）
export const defaultRateLimiter = new SlidingWindowRateLimiter({
  windowMs: 60_000,
  maxRequests: 15,
});
