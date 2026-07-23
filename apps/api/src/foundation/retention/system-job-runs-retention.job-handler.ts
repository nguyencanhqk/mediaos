import { Injectable, Logger, Optional } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { type Database, workerDb } from "../../db/index";
import { assertWorkerRoleSafe } from "../../db/worker-role";
import {
  SystemJobHandler,
  type JobHandler,
  type JobRunContext,
  type JobRunResult,
} from "../../scheduler/job-handler";

/**
 * S5-SYS-CLEAN-1 (🔴 crown — primitive XOÁ) — SystemJobRunsRetentionJobHandler.
 *
 * Dọn CÓ NGƯỠNG bảng `system_job_runs` (đo PROD 2026-07-24: 48.022 dòng/19 MB, phình mỗi nhịp scheduler).
 * KHÔNG gộp vào RetentionCleanupJob (vòng đó lặp `data_retention_policies` bằng model retentionDays PHẲNG,
 * chạy qua app-withTenant; `system_job_runs` là INFRA, cần ngưỡng-CÓ-ĐIỀU-KIỆN + xoá qua đường có DELETE).
 *
 * Cơ chế XOÁ (docs/plans/S5-SYS-CLEAN-1.md §3): gọi FUNCTION `purge_system_job_runs` (SECURITY DEFINER,
 * mig 0511) qua `workerDb` (role mediaos_worker, có EXECUTE — KHÔNG có DELETE bảng). Sàn ngày ép Ở SQL
 * (LMS ≥90 / khác ≥7) + allowlist status (chỉ Success/Skipped) + predicate `company_id = $1` ⇒ Failed/
 * Partial/Running + row global (NULL) GIỮ VĨNH VIỄN by-construction.
 *
 * Bất biến (mirror JobLockService/JobRunLogger):
 *  - `assertWorkerRoleSafe(mode:'prod-only')` TRƯỚC MỌI chạm DB; FAIL-CLOSED khi `workerDb` vắng.
 *  - Kill-switch `SYSTEM_JOB_RUNS_RETENTION_ENABLED`: MẶC ĐỊNH XOÁ THẬT (owner chốt 2026-07-24); chỉ TẮT
 *    (dry-run count-only) khi giá trị ∈ {false,0,off,no,disabled} (case-insensitive, trim) — nới hơn chuỗi
 *    'false' vì đây là công-tắc-dừng của job mặc-định-xoá-thật.
 *
 * Đăng ký: `@SystemJobHandler()` + khai báo trong `providers` của RetentionModule (giống
 * RetentionCleanupJobHandler) — SchedulerModule (DiscoveryService) tự gom qua metadata.
 */

/** jobCode DUY NHẤT toàn hệ — khoá `system_job_locks` + `system_job_runs.job_code`. */
export const SYSTEM_JOB_RUNS_RETENTION_JOB_CODE = "SYSTEM_JOB_RUNS_RETENTION";

/** Ngưỡng ngày cho job_code khác (owner chốt 30). SÀN CỨNG ≥7 ép Ở function 0511 (không tin caller). */
export const DEFAULT_RETENTION_DAYS = 30;
/** Ngưỡng ngày cho LMS_USER_SYNC (hợp đồng BE-4 §3D). SÀN CỨNG ≥90 ép Ở function 0511. */
export const LMS_RETENTION_DAYS = 90;
/** Trần row xoá 1 lô (chống lock lớn). Khớp guard TRẦN 100000 ở function. */
export const PURGE_BATCH_SIZE = 5000;
/** Trần số lô 1 nhịp (drain ≤200k/nhịp; chống loop vô hạn nếu backlog khổng lồ). */
export const MAX_BATCHES_PER_RUN = 40;
/** Ngưỡng cảnh báo nếu row global (company_id IS NULL) phình bất thường (owner: đếm cảnh báo). */
export const GLOBAL_ROWS_WARN = 1000;

/** Env kill-switch — MẶC ĐỊNH ON (xoá thật). */
const RETENTION_ENABLED_ENV = "SYSTEM_JOB_RUNS_RETENTION_ENABLED";
/** Giá trị TẮT (dry-run count-only), so khớp sau trim + lowercase. */
const OFF_VALUES = new Set(["false", "0", "off", "no", "disabled"]);

/** Đối số truyền cho `purge_system_job_runs` — tuple thứ tự tham số của function. */
export type PurgeArgs = readonly [
  companyId: string,
  defaultDays: number,
  lmsDays: number,
  batchSize: number,
  dryRun: boolean,
];

/**
 * Dựng đối số gọi `purge_system_job_runs` — helper THUẦN (unit-testable, không DB). PIN hợp đồng: handler
 * LUÔN truyền 30/90/5000 (sàn LMS 90 độc lập với sàn-cứng-SQL — hai tầng bổ trợ, §5.1 plan).
 */
export function buildPurgeArgs(companyId: string, dryRun: boolean): PurgeArgs {
  return [companyId, DEFAULT_RETENTION_DAYS, LMS_RETENTION_DAYS, PURGE_BATCH_SIZE, dryRun];
}

/** true = kill-switch TẮT (dry-run). Nới `{false,0,off,no,disabled}` (trim + lowercase); unset/khác → xoá thật. */
export function isRetentionDisabled(raw: string | undefined): boolean {
  return OFF_VALUES.has(
    String(raw ?? "")
      .trim()
      .toLowerCase(),
  );
}

@Injectable()
@SystemJobHandler()
export class SystemJobRunsRetentionJobHandler implements JobHandler {
  readonly jobCode = SYSTEM_JOB_RUNS_RETENTION_JOB_CODE;
  private readonly logger = new Logger(SystemJobRunsRetentionJobHandler.name);
  private roleChecked = false;

  // `@Optional()` BẮT BUỘC: đây là plain class provider (để DiscoveryService gom qua @SystemJobHandler
  // metadata), nhưng tham số `Database` KHÔNG phải Nest provider (module-level workerDb). Không có @Optional
  // thì Nest ném "can't resolve dependencies" ⇒ AppModule KHÔNG bootstrap (mọi int-spec dựng app đỏ). Với
  // @Optional, Nest truyền `undefined` khi không resolve được ⇒ default JS `workerDb ?? null` áp dụng (prod
  // lấy workerDb thật; int-spec truyền db tường minh qua `new`). Mirror WorkerSchedulerService @Optional.
  // `null` = KHÔNG có db (fail-closed tường minh, dùng int-spec).
  constructor(@Optional() private readonly dbw: Database | null = workerDb ?? null) {}

  /** workerDb tồn tại + role an toàn TRƯỚC mọi chạm DB. Fail-closed (throw) nếu thiếu db. */
  private async ensureWorkerSafe(): Promise<Database> {
    const dbw = this.dbw;
    if (!dbw) {
      throw new Error(
        "SystemJobRunsRetentionJobHandler: workerDb chưa cấu hình (DATABASE_WORKER_URL/DIRECT_URL) — fail-closed (KHÔNG xoá).",
      );
    }
    if (!this.roleChecked) {
      await assertWorkerRoleSafe(dbw, {
        context: "SystemJobRunsRetentionJobHandler",
        mode: "prod-only",
        logger: this.logger,
      });
      this.roleChecked = true;
    }
    return dbw;
  }

  /**
   * Dọn `system_job_runs` cho 1 tenant. dryRun theo kill-switch (mặc định XOÁ THẬT). Xoá theo LÔ (function
   * trả số row/lô) tới khi cạn hoặc chạm trần lô. KHÔNG catch — lỗi propagate cho JobRunner finalize 'Failed'.
   */
  async run(ctx: JobRunContext): Promise<JobRunResult> {
    const { companyId } = ctx;
    const dbw = await this.ensureWorkerSafe();
    const dryRun = isRetentionDisabled(process.env[RETENTION_ENABLED_ENV]);

    if (dryRun) {
      const eligible = await this.purgeBatch(dbw, companyId, true);
      const globalRowsKept = await this.countGlobalRows(dbw);
      // Kill-switch OFF là trạng-thái-vận-hành đáng chú ý (ai đó tắt chủ đích) ⇒ log INFO để xác nhận
      // "phanh đã ăn". Ở delete-mode bình thường KHÔNG log INFO ⇒ vắng dòng này = phanh KHÔNG ăn (tín hiệu
      // cho operator lỡ gõ sai giá trị OFF). (silent-failure-hunter Hunt 4.)
      this.logger.log(
        `SYSTEM_JOB_RUNS_RETENTION tenant=${companyId} DRY-RUN (kill-switch OFF) eligible=${eligible} globalRowsKept=${globalRowsKept}`,
      );
      return {
        total: 1,
        success: 1,
        failed: 0,
        metadata: { deleted: 0, eligible, dryRun: true, batches: 0, globalRowsKept, capHit: false },
      };
    }

    let deleted = 0;
    let batches = 0;
    let lastN = 0;
    while (batches < MAX_BATCHES_PER_RUN) {
      lastN = await this.purgeBatch(dbw, companyId, false);
      batches += 1;
      deleted += lastN;
      if (lastN < PURGE_BATCH_SIZE) break; // cạn tenant này
    }
    // capHit = thoát vì chạm trần lô VỚI lô cuối ĐẦY (còn row chưa dọn — bắt lại nhịp sau).
    const capHit = lastN === PURGE_BATCH_SIZE && batches === MAX_BATCHES_PER_RUN;

    // Silent-0 self-check (silent-failure-hunter Hunt 1): deleted=0 có thể là "cạn THẬT" HOẶC "câm" (owner
    // function mất BYPASSRLS ⇒ DELETE bị FORCE-RLS lọc 0 row KHÔNG lỗi ⇒ retention xanh mà không dọn gì —
    // đúng loại phình vô hình WO này sinh ra để chặn). Nếu eligible>0 mà deleted=0 = CHỮ KÝ silent-0 ⇒ warn.
    // Chỉ tốn 1 count trên nhịp no-op (deleted=0).
    if (deleted === 0) {
      const eligible = await this.purgeBatch(dbw, companyId, true);
      if (eligible > 0) {
        this.logger.warn(
          `SYSTEM_JOB_RUNS_RETENTION tenant=${companyId}: deleted=0 nhưng eligible=${eligible} — nghi function bị RLS lọc 0-row CÂM (owner mất BYPASSRLS?); retention có thể KHÔNG chạy.`,
        );
      }
    }

    const globalRowsKept = await this.countGlobalRows(dbw);
    if (globalRowsKept > GLOBAL_ROWS_WARN) {
      this.logger.warn(
        `SYSTEM_JOB_RUNS_RETENTION: row global (company_id IS NULL) = ${globalRowsKept} > ${GLOBAL_ROWS_WARN} — kiểm tra job cấp system có spam không (retention GIỮ vĩnh viễn row global).`,
      );
    }
    if (deleted > 0 || capHit) {
      this.logger.debug(
        `SYSTEM_JOB_RUNS_RETENTION tenant=${companyId} deleted=${deleted} batches=${batches} capHit=${capHit} globalRowsKept=${globalRowsKept}`,
      );
    }

    return {
      total: batches,
      success: batches,
      failed: 0,
      metadata: { deleted, dryRun: false, batches, globalRowsKept, capHit },
    };
  }

  /**
   * Gọi `purge_system_job_runs` 1 lần. dryRun=true → trả số ELIGIBLE (không xoá); false → trả số ĐÃ XOÁ.
   * Đối số qua `buildPurgeArgs` (pin 30/90/5000). Function SECURITY DEFINER lo sàn ngày + allowlist status.
   */
  private async purgeBatch(dbw: Database, companyId: string, dryRun: boolean): Promise<number> {
    const [id, defaultDays, lmsDays, batchSize, dry] = buildPurgeArgs(companyId, dryRun);
    const res = await dbw.execute(sql`
      SELECT purge_system_job_runs(${id}::uuid, ${defaultDays}, ${lmsDays}, ${batchSize}, ${dry}) AS n
    `);
    const row = res.rows[0] as { n: number | string } | undefined;
    return toFiniteCount(row?.n);
  }

  /**
   * Đếm row global (company_id IS NULL) — GIỮ VĨNH VIỄN (owner #3), chỉ để cảnh báo phình. Worker có SELECT
   * + policy `system_job_runs_worker_all` USING(true) ⇒ thấy row global.
   */
  private async countGlobalRows(dbw: Database): Promise<number> {
    const res = await dbw.execute(sql`
      SELECT count(*)::int AS n FROM system_job_runs WHERE company_id IS NULL
    `);
    const row = res.rows[0] as { n: number | string } | undefined;
    return toFiniteCount(row?.n);
  }
}

/**
 * Ép giá trị đếm/xoá về số HỮU HẠN ≥0. `RETURNS integer`/`count(*)::int` → node-postgres cho number, nhưng
 * coalesce phòng thủ NaN/undefined (silent-failure-hunter Hunt 3): NaN sẽ làm `lastN < BATCH` = false ⇒ loop
 * chạy tới cap + metadata `deleted=NaN`. Trả 0 khi không hữu hạn.
 */
function toFiniteCount(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
}
