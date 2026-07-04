import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { type Database, workerDb } from "../db/index";
import { assertWorkerRoleSafe } from "../db/worker-role";

/**
 * JobLockService (S2-FND-JOBS-1) — chống chạy trùng system job giữa các instance qua bảng `system_job_locks`
 * (thay advisory-lock có-thể-quan-sát). Ghi qua `workerDb` (role mediaos_worker, NOBYPASSRLS). Gọi
 * `assertWorkerRoleSafe(mode:'prod-only')` TRƯỚC MỌI INSERT/UPDATE (BẤT BIẾN #1 — chặn worker chạy bằng role
 * BYPASS RLS). FAIL-CLOSED khi `workerDb` vắng (throw, KHÔNG chạy mù).
 *
 * `system_job_locks`: `job_code` PK · không company_id · no-RLS (hạ tầng worker). Release = UPDATE
 * `locked_until` về quá khứ — KHÔNG DELETE (BẤT BIẾN #2).
 *
 * Db được truyền qua constructor (default = module `workerDb`) để int-spec kiểm chứng role thật (superuser
 * bypassrls) mà KHÔNG mock; provider của SchedulerModule dựng qua useFactory → `new JobLockService()`.
 */
@Injectable()
export class JobLockService {
  private readonly logger = new Logger(JobLockService.name);
  /** Đã kiểm role kết nối chưa (chỉ kiểm 1 lần/instance). */
  private roleChecked = false;

  // `null` = KHÔNG có db (fail-closed tường minh, dùng int-spec); vắng/undefined → default module workerDb.
  constructor(private readonly dbw: Database | null = workerDb ?? null) {}

  /** workerDb tồn tại + role an toàn TRƯỚC mọi INSERT/UPDATE. Fail-closed (throw) nếu thiếu db. */
  private async ensureWorkerSafe(): Promise<Database> {
    const dbw = this.dbw;
    if (!dbw) {
      throw new Error(
        "JobLockService: workerDb chưa cấu hình (DATABASE_WORKER_URL/DIRECT_URL) — fail-closed (KHÔNG ghi lock).",
      );
    }
    if (!this.roleChecked) {
      await assertWorkerRoleSafe(dbw, {
        context: "JobLockService",
        mode: "prod-only",
        logger: this.logger,
      });
      this.roleChecked = true;
    }
    return dbw;
  }

  /**
   * Acquire lock cho `jobCode`. INSERT ... ON CONFLICT (job_code) DO UPDATE ... WHERE locked_until < now()
   * RETURNING. Trả `true` nếu chiếm được (có row RETURNING: insert mới HOẶC lock cũ đã hết hạn), `false`
   * nếu lock còn hiệu lực (instance khác đang chạy — WHERE false ⇒ UPDATE bỏ qua ⇒ 0 row).
   *
   * Đồng thời an toàn: 2 instance cùng INSERT → unique(job_code) serialize; kẻ thua vào DO UPDATE với
   * WHERE locked_until<now() = false (kẻ thắng vừa set tương lai) ⇒ 0 row ⇒ đúng 1 kẻ chiếm.
   */
  async acquire(jobCode: string, lockedBy: string, ttlMs: number): Promise<boolean> {
    const dbw = await this.ensureWorkerSafe();
    const res = await dbw.execute(sql`
      INSERT INTO system_job_locks (job_code, locked_by, locked_until, acquired_at)
      VALUES (${jobCode}, ${lockedBy}, now() + make_interval(secs => ${ttlMs / 1000}), now())
      ON CONFLICT (job_code) DO UPDATE
        SET locked_by = EXCLUDED.locked_by,
            locked_until = EXCLUDED.locked_until,
            acquired_at = now()
        WHERE system_job_locks.locked_until < now()
      RETURNING job_code
    `);
    return res.rows.length > 0;
  }

  /**
   * Release lock = UPDATE `locked_until` về quá khứ (KHÔNG DELETE — BẤT BIẾN #2). Idempotent: release lock
   * không tồn tại → 0 row cập nhật, không lỗi.
   */
  async release(jobCode: string): Promise<void> {
    const dbw = await this.ensureWorkerSafe();
    await dbw.execute(sql`
      UPDATE system_job_locks
      SET locked_until = now() - make_interval(secs => 1)
      WHERE job_code = ${jobCode}
    `);
  }
}
