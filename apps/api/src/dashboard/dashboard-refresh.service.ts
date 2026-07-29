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
 * ⟲ NỢ KIẾN TRÚC G14 — ĐÃ ĐÓNG bởi S6-SEC-MV-1 (mig 0534, 29/07/2026).
 *
 * Trước đó: REFRESH đòi quyền chủ sở hữu MV (= role migrator `mediaos`), nhưng `refreshDb` ưu tiên
 * `workerDb` (`mediaos_worker`) ⇒ đường refresh runtime này CHẾT ở mọi env có DATABASE_WORKER_URL
 * (PROD CÓ), từ G14 tới nay — chưa consumer nào gọi nên không lộ. Đo lại trên lane 29/07/2026:
 *   `mediaos_worker` → REFRESH ⇒ "permission denied for materialized view mv_dashboard_task_status"
 *   `mediaos` (owner) → REFRESH ⇒ OK, và làm 56→54 hàng / 38→37 tenant ⇒ dữ liệu ĐÃ cũ thật.
 *
 * Nay: gọi hàm `refresh_dashboard_mvs()` (SECURITY DEFINER, owner = `mediaos`, mig 0534). Thân hàm
 * chạy bằng quyền chủ sở hữu nên vừa đủ quyền REFRESH vừa CÓ BYPASSRLS để nhìn đủ hàng; worker chỉ
 * được EXECUTE. Chiến lược concurrent/non-concurrent chuyển VÀO hàm (một nơi duy nhất, cạnh chính
 * các MV) — xem chú thích trong 0534.
 *
 * ⚠️ ĐỪNG "sửa nhanh" bằng `ALTER MATERIALIZED VIEW ... OWNER TO mediaos_worker`: worker KHÔNG có
 * BYPASSRLS mà `tasks` FORCE RLS ⇒ REFRESH dưới quyền worker cho MV RỖNG LẶNG LẼ (mất sạch số liệu
 * dashboard mà không ai biết). Đổi chủ sở hữu là cái bẫy, không phải cái vá.
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

    // S6-SEC-MV-1 (mig 0534): MỘT lời gọi. Quyết định concurrent/non-concurrent + thứ tự hai MV nằm
    // TRONG hàm `refresh_dashboard_mvs()`, cạnh chính các MV — không còn nhân bản ở tầng TS.
    //
    // KHÔNG bọc .catch nuốt lỗi: refresh hỏng phải nổi lên cho caller (bài học KI-034). Đường này
    // vốn đã CHẾT lặng lẽ suốt từ G14; im lặng thêm một lần nữa là đúng cái bẫy vừa gỡ.
    const refreshedAt = await this.callRefreshFunction(db);
    this.logger.log(`Dashboard MVs refreshed at ${refreshedAt}`);
    return { refreshedAt };
  }

  /**
   * Gọi hàm SECURITY DEFINER (mig 0534). Worker chỉ cần EXECUTE — nó KHÔNG còn quyền SELECT hay
   * REFRESH thẳng trên MV, nên đây là đường refresh DUY NHẤT của runtime.
   */
  private async callRefreshFunction(db: NonNullable<typeof workerDb>): Promise<string> {
    try {
      const result = await db.execute(sql`SELECT refresh_dashboard_mvs() AS refreshed_at`);
      const value = result.rows[0]?.refreshed_at;
      // Hàm trả timestamptz; chuẩn hoá về ISO để giữ nguyên contract của refresh().
      return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`MV refresh failed: ${msg}`);
      throw new Error(`MV refresh failed: ${msg}`);
    }
  }
}
