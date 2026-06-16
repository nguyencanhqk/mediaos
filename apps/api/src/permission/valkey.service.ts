import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { loadEnv } from '../config/env.schema';

/**
 * ValkeyService — thin wrapper around ioredis for Valkey/Redis.
 *
 * Design: all methods are safe to call when Valkey is unavailable — they return null/undefined
 * and log WARN. The cache is best-effort; DB is always the source of truth.
 * Errors are never propagated to callers (fail-open for cache, never fail-closed).
 */
@Injectable()
export class ValkeyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ValkeyService.name);
  private client: Redis | null = null;

  onModuleInit(): void {
    const env = loadEnv();
    if (!env.VALKEY_URL) {
      this.logger.warn('VALKEY_URL not configured — Valkey cache disabled, all reads fallback to DB');
      return;
    }
    this.client = new Redis(env.VALKEY_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
    this.client.on('error', (err: Error) => {
      this.logger.warn('Valkey connection error', { message: err.message });
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit().catch(() => {
        // ignore quit errors on shutdown
      });
    }
  }

  /**
   * True khi một client Valkey ĐÃ được cấu hình (VALKEY_URL có) — KHÁC với "đang kết nối được". Caller
   * cần phân biệt "cache tắt" (null mơ hồ giữa lỗi vs thiếu key) với "cache bật" để chọn đường fail-soft
   * (vd LoginRateLimiter: bật → dùng Valkey; tắt → fallback in-memory single-instance).
   */
  isEnabled(): boolean {
    return this.client !== null;
  }

  /**
   * INCR nguyên tử + đặt EXPIRE ở lần tăng đầu (count===1) để counter tự hết hạn theo cửa sổ. Trả số đếm
   * mới, hoặc `null` khi Valkey chưa cấu hình / lỗi (caller fail-soft). Never throws.
   */
  async incr(key: string, ttlSec: number): Promise<number | null> {
    if (!this.client) return null;
    try {
      const n = await this.client.incr(key);
      if (n === 1) await this.client.expire(key, ttlSec);
      return n;
    } catch (err) {
      this.logger.warn('Valkey INCR error', { key, error: (err as Error).message });
      return null;
    }
  }

  /** Returns null if Valkey is unavailable or key missing. Never throws. */
  async get(key: string): Promise<string | null> {
    if (!this.client) return null;
    try {
      return await this.client.get(key);
    } catch (err) {
      this.logger.warn('Valkey GET error', { key, error: (err as Error).message });
      return null;
    }
  }

  /**
   * Returns true when the SET succeeds or Valkey is not configured (cache disabled is a no-op success).
   * Returns false on error so callers that NEED the write to be durable (e.g. the re-auth window) can
   * surface the failure instead of assuming success. Never throws.
   */
  async set(key: string, value: string, ttlSec: number): Promise<boolean> {
    if (!this.client) return true;
    try {
      await this.client.set(key, value, 'EX', ttlSec);
      return true;
    } catch (err) {
      this.logger.warn('Valkey SET error', { key, error: (err as Error).message });
      return false;
    }
  }

  /**
   * Atomic SET-IF-ABSENT (`SET key val EX ttl NX`). Trả `true` CHỈ KHI key chưa tồn tại và set thành công
   * (caller là người ĐẦU TIÊN giữ key) — `false` khi key đã có (duplicate). KHÁC `set()`: hàm này FAIL-CLOSED:
   *   - Valkey CHƯA cấu hình (client null) → trả `null` (KHÔNG no-op-success): caller PHẢI fallback in-memory,
   *     KHÔNG được coi là "đã giữ" (no-op true sẽ làm replay-guard luôn-pass = fail-open, hỏng single-use).
   *   - Lỗi outage → trả `null`: caller fallback in-memory (KHÔNG fail-open).
   * Dùng cho single-use jti (challenge 2FA) + TOTP step-replay (chống dùng lại cùng mã/step). Never throws.
   */
  async setNx(key: string, value: string, ttlSec: number): Promise<boolean | null> {
    if (!this.client) return null;
    try {
      const res = await this.client.set(key, value, "EX", ttlSec, "NX");
      // ioredis trả 'OK' khi set (key mới) hoặc null khi NX trượt (key đã tồn tại).
      return res === "OK";
    } catch (err) {
      this.logger.warn("Valkey SETNX error", { key, error: (err as Error).message });
      return null;
    }
  }

  /**
   * Returns true when the DEL succeeds or Valkey is not configured.
   * Returns false on error (caller can decide whether to retry or surface the failure).
   * Never throws.
   */
  async del(...keys: string[]): Promise<boolean> {
    if (!this.client) return true;
    try {
      if (keys.length > 0) await this.client.del(...keys);
      return true;
    } catch (err) {
      this.logger.warn('Valkey DEL error', { keys, error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }
}
