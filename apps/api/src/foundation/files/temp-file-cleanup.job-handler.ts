import { Inject, Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../db/db.service";
import type { FileRecord } from "../../db/schema/files";
import { AuditService } from "../../events/audit.service";
import {
  SystemJobHandler,
  type JobHandler,
  type JobRunContext,
  type JobRunResult,
} from "../../scheduler/job-handler";
import { STORAGE_ADAPTER, type StorageAdapter } from "../../storage/storage-adapter.port";
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
 *    NULL AND NOT EXISTS(file_links active, trừ link `Export` của tệp tạm) — link-safety: tham chiếu thật thì GIỮ.
 *  - BỎ QUA FilePolicy (KHÔNG đi FileService.deleteFile) — đây là dọn nền hệ thống, KHÔNG có user actor.
 *
 * S15-PAYROLL-BE-5B (owner O-3/O-6) — xoá CẢ object storage của mọi hàng được dọn:
 *  - Liệt kê trong một tx ngắn → mỗi tệp: xoá object NGOÀI tx (không giữ tx DB khi gọi S3) → tx ngắn xoá mềm
 *    hàng + gỡ link `Export` + log + audit.
 *  - Object TRƯỚC, hàng SAU: xoá object lỗi ⇒ GIỮ hàng (`failed`), lượt sau thử lại — không bao giờ có hàng
 *    đã xoá mà object còn nằm đó không ai dọn. S3 xoá key vắng = thành công ⇒ thử lại an toàn.
 *  - Chỉ provider object-store (`MinIO`/`S3`) mới gọi storage; provider khác giữ hành vi cũ (chỉ xoá mềm).
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

/** Provider mà `STORAGE_ADAPTER` (S3-compatible) xoá được object. */
const OBJECT_STORE_PROVIDERS: ReadonlySet<string> = new Set(["MinIO", "S3"]);

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
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  /**
   * Chạy cleanup cho 1 tenant. TỰ mở withTenant (BẤT BIẾN #1). Lỗi DB ném ra cho JobRunner finalize run-row
   * Failed (không chặn tenant kế). Lỗi xoá object của MỘT tệp ⇒ đếm `failed` + warn, tệp đó giữ nguyên cho
   * lượt sau. Xoá mềm + gỡ link + log + audit của một tệp nằm chung MỘT tx (commit/rollback đồng nhất).
   */
  async run(ctx: JobRunContext): Promise<JobRunResult> {
    const { companyId } = ctx;
    const ttlHours = await this.resolvePendingTtlHours(companyId);
    const now = new Date();
    const pendingCutoff = new Date(now.getTime() - ttlHours * MS_PER_HOUR);

    const eligible = await this.db.withTenant(companyId, (tx) =>
      this.repo.findEligibleTx(companyId, pendingCutoff, now, tx),
    );
    let success = 0;
    let failed = 0;

    for (const file of eligible) {
      const objectDeleted = await this.deleteObject(companyId, file);
      if (objectDeleted === "failed") {
        failed += 1;
        continue;
      }
      if (await this.softDeleteRow(companyId, file, objectDeleted === "deleted")) success += 1;
    }

    const skipped = eligible.length - success - failed;
    if (eligible.length > 0) {
      this.logger.debug(
        `TEMP_FILE_CLEANUP tenant=${companyId} eligible=${eligible.length} deleted=${success} skipped=${skipped} failed=${failed} ttlHours=${ttlHours}`,
      );
    }

    // skipped (race: hàng đã bị xoá song song) KHÔNG phải failure.
    return {
      total: eligible.length,
      success,
      failed,
      metadata: { deleted: success, skipped, failed, ttlHours },
    };
  }

  /** Xoá object (nếu provider là object-store). Không ném — lỗi trả `failed` để giữ hàng cho lượt sau. */
  private async deleteObject(
    companyId: string,
    file: FileRecord,
  ): Promise<"deleted" | "not-object-store" | "failed"> {
    if (!OBJECT_STORE_PROVIDERS.has(file.storageProvider)) return "not-object-store";
    try {
      await this.storage.delete({ key: file.storagePath, companyId });
      return "deleted";
    } catch (err) {
      const name = err instanceof Error ? err.name : typeof err;
      this.logger.warn(
        `TEMP_FILE_CLEANUP tenant=${companyId} file=${file.id} xoá object lỗi (${name}) — giữ hàng, thử lại lượt sau.`,
      );
      return "failed";
    }
  }

  /** Xoá mềm hàng + gỡ link Export + log + audit trong MỘT tx. `false` = hàng đã bị xoá song song. */
  private softDeleteRow(
    companyId: string,
    file: FileRecord,
    objectDeleted: boolean,
  ): Promise<boolean> {
    return this.db.withTenant(companyId, async (tx) => {
      // Idempotent + chống race: nếu file đã bị xoá song song (0 row) → bỏ qua (KHÔNG ghi log/audit thừa).
      const affected = await this.repo.softDeleteBySystemTx(companyId, file.id, tx);
      if (affected === 0) return false;
      const exportLinksRemoved = await this.repo.softDeleteExportLinksBySystemTx(
        companyId,
        file.id,
        tx,
      );

      // file_access_logs: Delete accessGranted=true, actorUserId KHÔNG set ⇒ null (System actor). Append-only.
      await this.accessLog.record(tx, {
        fileId: file.id,
        action: "Delete",
        accessGranted: true,
      });

      // audit: objectType=file (đã có trong CHECK — KHÔNG migration), actorType=System actorUserId=null.
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
          objectDeleted,
          exportLinksRemoved,
        },
      });
      return true;
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
