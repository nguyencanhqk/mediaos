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
