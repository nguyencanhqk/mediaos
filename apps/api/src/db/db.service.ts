import { Injectable, Logger } from "@nestjs/common";
import { directPool, pool } from "./index";

export interface DbPingResult {
  ok: boolean;
  latencyMs: number | null;
  error?: string;
}

/**
 * Cổng truy cập hạ tầng DB cho Nest DI. G1: chỉ `ping()` fail-soft cho health-check.
 * G2-2 sẽ bổ sung `withTenant(companyId, fn)` ở đây (set_config trong transaction).
 */
@Injectable()
export class DatabaseService {
  private readonly logger = new Logger(DatabaseService.name);

  async ping(): Promise<DbPingResult> {
    const target = pool ?? directPool;
    if (!target) {
      return { ok: false, latencyMs: null, error: "DATABASE_URL not configured" };
    }

    const start = Date.now();
    try {
      await target.query("SELECT 1");
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      this.logger.warn(`DB ping failed: ${message}`);
      return { ok: false, latencyMs: null, error: message };
    }
  }
}
