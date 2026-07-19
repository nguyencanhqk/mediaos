import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { workerDb, directPool } from "../db/index";
import { assertWorkerRoleSafe } from "../db/worker-role";
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
 *  - Subsequent: use REFRESH CONCURRENTLY so reads are not blocked (CHỈ mv_dashboard_task_status —
 *    xem refreshConcurrently).
 *
 * ⚠️ NỢ KIẾN TRÚC G14 (phát hiện S5-DASH-TASKSTATUS-FIX-1, 20/07/2026 — CÓ TỪ TRƯỚC, chưa sửa ở WO đó):
 * REFRESH đòi role là OWNER của MV (= role migrator `mediaos`), nhưng refreshDb ưu tiên workerDb
 * (`mediaos_worker`) ⇒ đường refresh runtime này FAIL "must be owner" ở mọi env có DATABASE_WORKER_URL,
 * từ G14 tới nay (chưa spec/consumer nào gọi tới nên không lộ). KHÔNG được "sửa nhanh" bằng
 * `ALTER MATERIALIZED VIEW ... OWNER TO mediaos_worker`: worker KHÔNG có BYPASSRLS mà `tasks` FORCE
 * RLS ⇒ REFRESH chạy bằng quyền worker sẽ cho MV RỖNG LẶNG LẼ (mất số liệu dashboard không ai biết).
 * Sửa thật = WO riêng (role refresh chuyên trách có BYPASSRLS, hoặc SECURITY DEFINER function).
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
      throw new Error(
        "DashboardRefreshService: no worker/direct pool configured — cannot refresh materialized views",
      );
    }

    // BẤT BIẾN #1 (G16 #3): khi DATABASE_WORKER_URL vắng, refreshDb fallback directPool có thể là role
    // đặc quyền (bypass RLS) → chặn ở prod, cảnh báo to ở dev. Trước đây path này KHÔNG kiểm role (gap).
    await assertWorkerRoleSafe(db, {
      context: "DashboardRefreshService",
      mode: "prod-only",
      logger: this.logger,
    });

    // Determine whether MV already has data. Errors here bubble up (fail-loud).
    const populated = await this.isMvPopulated(db);

    if (!populated) {
      // First populate — cannot use CONCURRENTLY on empty MV
      this.logger.log("MV not yet populated — running initial REFRESH (non-concurrent)");
      await this.refreshNonConcurrent(db);
    } else {
      // Subsequent refresh — CONCURRENTLY (chỉ mv_dashboard_task_status) avoids read-lock
      this.logger.log("Running REFRESH MATERIALIZED VIEW CONCURRENTLY");
      await this.refreshConcurrently(db);
    }
    const refreshedAt = new Date().toISOString();
    this.logger.log(`Dashboard MVs refreshed at ${refreshedAt}`);
    return { refreshedAt };
  }

  private async isMvPopulated(db: NonNullable<typeof workerDb>): Promise<boolean> {
    // Errors surface to refresh() caller — no silent fallback.
    const result = await db.execute(sql`SELECT 1 FROM mv_dashboard_task_status LIMIT 1`);
    return result.rows.length > 0;
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

  /**
   * S5-DASH-TASKSTATUS-FIX-1 (thực nghiệm 20/07, spec C6): CONCURRENTLY CHỈ mv_dashboard_task_status
   * (unique index CỘT TRẦN — 0502). mv_dashboard_output KHÔNG BAO GIỜ concurrently được — unique
   * index của nó là BIỂU THỨC COALESCE (0102), Postgres đòi cột trần ⇒ đi REFRESH THƯỜNG ngay trong
   * nhánh này. Bug tiềm ẩn từ G14 (lần refresh thứ 2 luôn 500); lộ NGAY LẦN ĐẦU sau 0502 (task_status
   * populate lúc migrate ⇒ probe true ⇒ vào nhánh này). Họ media PARKED, 0 consumer ⇒ chấp nhận khoá
   * đọc ngắn; sửa thật (index NULLS NOT DISTINCT hoặc gỡ MV) thuộc WO dọn de-media-fy.
   */
  private async refreshConcurrently(db: NonNullable<typeof workerDb>): Promise<void> {
    try {
      await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_task_status`);
      await db.execute(sql`REFRESH MATERIALIZED VIEW mv_dashboard_output`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Concurrent MV refresh failed: ${msg}`);
      throw new Error(`MV refresh failed: ${msg}`);
    }
  }
}
