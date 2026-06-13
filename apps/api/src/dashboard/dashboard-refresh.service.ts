import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { workerDb, directPool } from "../db/index";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";

/**
 * DashboardRefreshService — refreshes materialized views mv_dashboard_task_status and mv_dashboard_output.
 *
 * Uses workerPool (direct connection, not PgBouncer) so the role has REFRESH privileges.
 * App-pool (RLS-forced, PgBouncer transaction-mode) must NOT be used for REFRESH.
 *
 * Strategy:
 *  - First-time (MV is empty / WITH NO DATA): use non-concurrent REFRESH to populate.
 *  - Subsequent: use REFRESH CONCURRENTLY so reads are not blocked.
 */
@Injectable()
export class DashboardRefreshService {
  private readonly logger = new Logger(DashboardRefreshService.name);

  private get refreshDb() {
    if (workerDb) return workerDb;
    // fallback: build a drizzle client directly on directPool
    if (directPool) return drizzle(directPool, { schema });
    return null;
  }

  async refresh(): Promise<{ refreshedAt: string }> {
    const db = this.refreshDb;
    if (!db) {
      this.logger.warn("DashboardRefreshService: no worker/direct pool configured — skipping refresh");
      return { refreshedAt: new Date().toISOString() };
    }

    // Check if MV has been populated (has at least 1 row = was refreshed before)
    const populated = await this.isMvPopulated(db);

    if (!populated) {
      // First populate — cannot use CONCURRENTLY on empty MV
      this.logger.log("MV not yet populated — running initial REFRESH (non-concurrent)");
      await this.refreshNonConcurrent(db);
    } else {
      // Subsequent refresh — CONCURRENTLY avoids read-lock
      this.logger.log("Running REFRESH MATERIALIZED VIEW CONCURRENTLY");
      await this.refreshConcurrently(db);
    }

    const refreshedAt = new Date().toISOString();
    this.logger.log(`Dashboard MVs refreshed at ${refreshedAt}`);
    return { refreshedAt };
  }

  private async isMvPopulated(db: NonNullable<typeof workerDb>): Promise<boolean> {
    try {
      const result = await db.execute(
        sql`SELECT 1 FROM mv_dashboard_task_status LIMIT 1`,
      );
      return result.rows.length > 0;
    } catch (err: unknown) {
      // If MV doesn't exist yet, treat as not populated
      this.logger.warn(`isMvPopulated check failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  private async refreshNonConcurrent(db: NonNullable<typeof workerDb>): Promise<void> {
    try {
      await db.execute(sql`REFRESH MATERIALIZED VIEW mv_dashboard_task_status`);
      await db.execute(sql`REFRESH MATERIALIZED VIEW mv_dashboard_output`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Non-concurrent MV refresh failed: ${msg}`);
      throw new Error(`MV refresh failed: ${msg}`);
    }
  }

  private async refreshConcurrently(db: NonNullable<typeof workerDb>): Promise<void> {
    try {
      await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_task_status`);
      await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_output`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Concurrent MV refresh failed: ${msg}`);
      throw new Error(`MV refresh failed: ${msg}`);
    }
  }
}
