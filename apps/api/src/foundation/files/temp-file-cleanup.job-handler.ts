import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../db/db.service";
import { AuditService } from "../../events/audit.service";
import {
  SystemJobHandler,
  type JobHandler,
  type JobRunContext,
  type JobRunResult,
} from "../../scheduler/job-handler";
import { SettingService } from "../settings/setting.service";
import { FileAccessLogService } from "./file-access-log.service";
import { TempFileCleanupRepository } from "./temp-file-cleanup.repository";

/**
 * S2-FND-JOBS-1 (jobs_tempfile · crown audit/file-soft-delete) — TempFileCleanupJobHandler.
 *
 * Dọn file tạm hết hạn / upload dở dang treo. Đăng ký `@SystemJobHandler()` + khai báo trong `providers` của
 * FilesModule (giống RetentionModule) — SchedulerModule (DiscoveryService) tự gom qua metadata; FilesModule
 * KHÔNG import SchedulerModule (phụ thuộc MỘT HƯỚNG Scheduler→feature, KHÔNG import cycle). Chỉ import file
 * token `scheduler/job-handler`.
 *
 * Bất biến:
 *  - BẤT BIẾN #1: run({companyId}) TỰ mở `withTenant(companyId, …)` — KHÔNG nhận tx từ JobRunner (contract
 *    JobRunContext = chỉ `companyId`). JobRunner enumerate tenant + đóng tx TRƯỚC khi gọi run ⇒ KHÔNG nested.
 *  - BẤT BIẾN #2: soft-delete (deleted_at + upload_status='Deleted', deleted_by=NULL) — KHÔNG hard-delete;
 *    file_access_logs + audit_logs append-only (INSERT-only, cùng tx nghiệp vụ ⇒ commit/rollback đồng nhất).
 *  - Eligibility = (is_temporary AND expires_at<now) OR (upload_status='Pending' quá TTL) AND deleted_at IS
 *    NULL AND NOT EXISTS(file_links active) — link-safety: file còn tham chiếu thì GIỮ.
 *  - BỎ QUA FilePolicy (KHÔNG đi FileService.deleteFile) — đây là dọn nền hệ thống, KHÔNG có user actor.
 */

/** jobCode DUY NHẤT toàn hệ — khoá `system_job_locks` + `system_job_runs.job_code`. */
export const TEMP_FILE_CLEANUP_JOB_CODE = "TEMP_FILE_CLEANUP";

/** Setting key cho TTL Pending (giờ). Precedence company>system>default (S1-FND-SETTING-1). */
const PENDING_TTL_KEY = "file.pending_ttl_hours";

/**
 * Fallback khi setting malformed (NaN / ≤0) — TRÙNG default trong setting-defaults.ts. Fail-safe: KHÔNG để
 * cutoff = now (ttl=0) hay NaN (so sánh luôn false) làm cleanup sai/không chạy. 24h = 1 ngày.
 */
const DEFAULT_PENDING_TTL_HOURS = 24;
const MS_PER_HOUR = 3_600_000;

@Injectable()
@SystemJobHandler()
export class TempFileCleanupJobHandler implements JobHandler {
  readonly jobCode = TEMP_FILE_CLEANUP_JOB_CODE;
  private readonly logger = new Logger(TempFileCleanupJobHandler.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TempFileCleanupRepository,
    private readonly accessLog: FileAccessLogService,
    private readonly audit: AuditService,
    private readonly settings: SettingService,
  ) {}

  /**
   * Chạy cleanup cho 1 tenant. TỰ mở withTenant (BẤT BIẾN #1). KHÔNG catch trong vòng — lỗi propagate cho
   * JobRunner finalize run-row 'Failed' (finish-once, KHÔNG chặn tenant kế). Toàn bộ soft-delete + log + audit
   * trong MỘT tx (audit-in-tx: commit/rollback đồng nhất — KHÔNG ghi nửa vời).
   */
  async run(ctx: JobRunContext): Promise<JobRunResult> {
    const { companyId } = ctx;
    const ttlHours = await this.resolvePendingTtlHours(companyId);
    const now = new Date();
    const pendingCutoff = new Date(now.getTime() - ttlHours * MS_PER_HOUR);

    return this.db.withTenant(companyId, async (tx) => {
      const eligible = await this.repo.findEligibleTx(companyId, pendingCutoff, now, tx);
      let success = 0;

      for (const file of eligible) {
        // Idempotent + chống race: nếu file đã bị xoá song song (0 row) → bỏ qua (KHÔNG ghi log/audit thừa).
        const affected = await this.repo.softDeleteBySystemTx(companyId, file.id, tx);
        if (affected === 0) continue;

        // file_access_logs: Delete accessGranted=true, actorUserId KHÔNG set ⇒ null (System actor). Append-only.
        await this.accessLog.record(tx, {
          fileId: file.id,
          action: "Delete",
          accessGranted: true,
        });

        // audit: objectType='file' (đã có trong CHECK — KHÔNG migration), actorType='System' actorUserId=null.
        // before = metadata KHÔNG nhạy cảm (masker vẫn che storage_path/signed_url — không đưa vào đây).
        await this.audit.record(tx, {
          action: "FileDeleted",
          objectType: "file",
          objectId: file.id,
          actorType: "System",
          resultStatus: "Success",
          dataScope: "Company",
          before: {
            originalName: file.originalName,
            mimeType: file.mimeType,
            isTemporary: file.isTemporary,
            uploadStatus: file.uploadStatus,
          },
          metadata: {
            reason: file.isTemporary ? "temp-expired" : "pending-ttl-exceeded",
            jobCode: this.jobCode,
          },
        });

        success += 1;
      }

      const skipped = eligible.length - success;
      if (eligible.length > 0) {
        this.logger.debug(
          `TEMP_FILE_CLEANUP tenant=${companyId} eligible=${eligible.length} deleted=${success} skipped=${skipped} ttlHours=${ttlHours}`,
        );
      }

      // failed=0: mọi lỗi ghi/DB đã ném (rollback toàn tx) → KHÔNG tới đây. skipped (race) KHÔNG phải failure.
      return {
        total: eligible.length,
        success,
        failed: 0,
        metadata: { deleted: success, skipped, ttlHours },
      };
    });
  }

  /**
   * Giải TTL Pending (giờ) theo precedence company>system>default (SettingService). Coerce an toàn: number
   * hoặc chuỗi số dương → dùng; malformed/≤0 → fallback DEFAULT_PENDING_TTL_HOURS (fail-safe, KHÔNG NaN/0).
   */
  private async resolvePendingTtlHours(companyId: string): Promise<number> {
    const resolved = await this.settings.resolveSetting(companyId, PENDING_TTL_KEY);
    const raw = resolved.value;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      this.logger.warn(
        `${PENDING_TTL_KEY} không hợp lệ (${JSON.stringify(raw)}) — fallback ${DEFAULT_PENDING_TTL_HOURS}h.`,
      );
      return DEFAULT_PENDING_TTL_HOURS;
    }
    return n;
  }
}
