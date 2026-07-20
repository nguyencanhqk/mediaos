import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import {
  FOUNDATION_FILE_ERROR_CODES,
  type DownloadUrlDto,
  type ListTaskFilesQuery,
  type TaskFileDto,
} from "@mediaos/contracts";
import { sql, type SQL } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { DataScopeService } from "../permission/data-scope.service";
import { FileService } from "../foundation/files/files.service";
import { TaskCoreRepository, type TaskScopeMode } from "./task-core.repository";
import {
  TASK_ENTITY,
  TASK_MODULE,
  TaskFileRepository,
  type TaskFileRow,
} from "./task-file.repository";
import { AuditService } from "../events/audit.service";
import { pgErrorCode, PG_UNIQUE_VIOLATION } from "../common/db-error";
import { TaskActivityService } from "./task-activity.service";

interface RequestUser {
  id: string;
  companyId: string;
}

/** resourceType + actions for task-file data_scope (matches seed mig 0485). */
const TASK_RESOURCE = "task";
const ACTION_READ = "read";
const ACTION_UPLOAD = "file-upload";
const ACTION_DELETE = "file-delete";

const ERR_TASK_NOT_FOUND = "TASK-ERR-TASK-NOT-FOUND: không tìm thấy công việc.";
const ERR_FILE_NOT_FOUND = "TASK-ERR-FILE-NOT-FOUND: không tìm thấy tệp đính kèm.";

/**
 * S5-TASK-COVER-1 — từ chối đặt bìa bằng tệp đang được gắn ở entity KHÁC. Xem docblock
 * `FileRepository.findVerifiedTaskCoversTx` về lý do (chống leo thang đọc qua FilePolicy AND-mọi-link).
 */
const TASK_COVER_SHARED_CODE = "TASK-ERR-COVER-SHARED";

/**
 * classid cho `pg_advisory_xact_lock(classid, objid)` của luồng đổi ảnh bìa TASK.
 * Không gian khoá advisory là TOÀN CỤC trong một database ⇒ dùng dạng 2 tham số với classid đặt tên
 * rõ, thay vì nhét `hashtext('chuỗi nào đó')` tại chỗ và để module sau va phải.
 */
const ADVISORY_CLASS_TASK_COVER = 0x5401;

/**
 * Mã lỗi Postgres phải quy về 409, KHÔNG BAO GIỜ để rơi ra thành 500.
 *
 * Advisory lock ở `setCover` CHỈ tuần-tự-hoá setCover-với-setCover. Các writer KHÁC của
 * `file_links.is_primary` — `POST /foundation/files/:id/links` với isPrimary=true, và `unlink` —
 * KHÔNG lấy khoá đó, nên vẫn có thể đụng `uq_file_links_primary_per_entity_type` (23505) hoặc khoá
 * hàng theo thứ tự ngược (40P01 deadlock / 40001 serialization). Cả ba đều là "va chạm đồng thời,
 * thử lại đi" — đúng ngữ nghĩa 409, không phải lỗi máy chủ.
 */
const PG_DEADLOCK = "40P01";
const PG_SERIALIZATION_FAILURE = "40001";
const CONFLICT_PG_CODES = new Set([PG_UNIQUE_VIOLATION, PG_DEADLOCK, PG_SERIALIZATION_FAILURE]);
const TASK_COVER_CONFLICT_CODE = "TASK-ERR-COVER-CONFLICT";

/** Quy va-chạm-đồng-thời của Postgres về 409; mọi lỗi khác PHẢI propagate (không nuốt). */
function rethrowAsConflict(err: unknown): never {
  const code = pgErrorCode(err);
  if (code && CONFLICT_PG_CODES.has(code)) {
    throw new ConflictException({
      code: TASK_COVER_CONFLICT_CODE,
      message: `${TASK_COVER_CONFLICT_CODE}: ảnh bìa vừa bị người khác đổi cùng lúc, thử lại.`,
    });
  }
  throw err;
}

/**
 * scan_status values that MAY be downloaded. STRICTER than FileService's own state-guard (which only blocks
 * Infected + not-Uploaded): a task attachment must be Clean or NotRequired — Pending/Failed/Infected all 409
 * BEFORE a signed URL is minted (defense against serving unscanned content).
 */
const DOWNLOADABLE_SCAN = new Set(["Clean", "NotRequired"]);

/**
 * S4-TASK-BE-5 — Task File service (đính kèm công việc). Reuses the S2-HR-EMPFILE-1 pattern; NO task_files
 * table — the polymorphic file_links (module_code='TASK', entity_type='task') is the canonical surface.
 * Crown-jewel touch points:
 *  - BẤT BIẾN #1: every read/write runs in withTenant(user.companyId); the repo ANDs company_id; RLS+FORCE
 *    is the final wall. cross-tenant task/file ⇒ RLS 0-row ⇒ 404 (no leak).
 *  - IDOR: assertScope resolves the data_scope for the (action,'task') pair and isTaskInScopeTx the target
 *    task (assignee-in-scope OR active project-member); findLinkedFileTx proves the file belongs to THIS
 *    task (cross-task → 404). Out-of-scope / not-found ⇒ 404 (never 403-after-200, never oracle).
 *  - BẤT BIẾN #2: no own audit object_type — FileService owns file_link/file soft-delete + FileLinked/
 *    FileDeleted audit (append-only) + Link/Download/Delete access-log, all in its own tenant tx. This
 *    service additionally appends TASK_FILE_UPLOADED/TASK_FILE_DELETED to task_activity_logs (append-only).
 *  - Scan-guard: download only for Clean/NotRequired (409 otherwise) BEFORE FileService.getDownloadUrl.
 *
 * The controller's @RequirePermission('read'|'file-upload'|'file-delete','task') is the COARSE gate (403
 * when no grant at all). This service adds the FINE data_scope narrowing + per-task in-scope check.
 */
@Injectable()
export class TaskFileService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TaskFileRepository,
    private readonly coreRepo: TaskCoreRepository,
    private readonly dataScope: DataScopeService,
    private readonly files: FileService,
    private readonly activity: TaskActivityService,
    // S5-TASK-COVER-1 — audit cho mutate file_links (đổi/gỡ bìa). Đặt CUỐI (spec dựng theo VỊ TRÍ).
    private readonly audit: AuditService,
  ) {}

  // ── List ────────────────────────────────────────────────────────────────────

  async list(user: RequestUser, taskId: string, query: ListTaskFilesQuery): Promise<TaskFileDto[]> {
    await this.assertScope(user, taskId, ACTION_READ);
    return this.db.withTenant(user.companyId, async (tx) => {
      const rows = await this.repo.listLinkedFilesByTaskTx(
        tx,
        user.companyId,
        taskId,
        query.category,
      );
      return rows.map((r) => this.toDto(r));
    });
  }

  // ── Metadata (single) ─────────────────────────────────────────────────────────

  async getMetadata(user: RequestUser, taskId: string, fileId: string): Promise<TaskFileDto> {
    await this.assertScope(user, taskId, ACTION_READ);
    const row = await this.loadLinkedFileOr404(user, taskId, fileId);
    return this.toDto(row);
  }

  // ── Download (signed URL, TTL-ngắn) ─────────────────────────────────────────────

  async getDownloadUrl(user: RequestUser, taskId: string, fileId: string): Promise<DownloadUrlDto> {
    await this.assertScope(user, taskId, ACTION_READ);
    const row = await this.loadLinkedFileOr404(user, taskId, fileId);

    // STRICT scan-guard BEFORE FileService: only Clean/NotRequired may be presigned (409 otherwise).
    if (!DOWNLOADABLE_SCAN.has(row.scanStatus)) {
      throw new ConflictException({
        code: FOUNDATION_FILE_ERROR_CODES.NOT_DOWNLOADABLE,
        message: `${FOUNDATION_FILE_ERROR_CODES.NOT_DOWNLOADABLE}: file chưa quét sạch (scan_status=${row.scanStatus}).`,
      });
    }

    // FileService re-checks authorization (resolver) + upload-state-guard + writes the Download access-log.
    return this.files.getDownloadUrl(user, fileId);
  }

  // ── Link (attach an already uploaded+confirmed file) ────────────────────────────

  async link(
    user: RequestUser,
    taskId: string,
    fileId: string,
    category?: string,
  ): Promise<TaskFileDto> {
    await this.assertScope(user, taskId, ACTION_UPLOAD);

    // FileService.link: resolver gate (canLinkFile) + validate file tenant/scan + insert file_links +
    // audit FileLinked (object_type 'file_link') + access-log Link — all in its own tenant tx.
    await this.files.link(user, {
      fileId,
      moduleCode: TASK_MODULE,
      entityType: TASK_ENTITY,
      entityId: taskId,
      linkType: "Attachment",
      accessScope: "Company",
      isPrimary: false,
      purpose: category,
    });

    await this.recordActivity(
      user,
      taskId,
      fileId,
      "TASK_FILE_UPLOADED",
      "Đính kèm tệp vào công việc",
    );

    const row = await this.loadLinkedFileOr404(user, taskId, fileId);
    return this.toDto(row);
  }

  // ── Delete (soft) ────────────────────────────────────────────────────────────

  async delete(user: RequestUser, taskId: string, fileId: string): Promise<void> {
    await this.assertScope(user, taskId, ACTION_DELETE);
    // Prove the file belongs to THIS task (cross-task → 404) before FileService soft-deletes it.
    await this.loadLinkedFileOr404(user, taskId, fileId);

    // FileService.deleteFile: resolver gate (canDeleteFile) + soft-delete files (deleted_at) + audit
    // FileDeleted (object_type 'file') + access-log Delete. Removes it from the list (files.deleted_at).
    await this.files.deleteFile(user, fileId);

    await this.recordActivity(
      user,
      taskId,
      fileId,
      "TASK_FILE_DELETED",
      "Gỡ tệp đính kèm khỏi công việc",
    );
  }

  // ── Cover (S5-TASK-COVER-1) ──────────────────────────────────────────────────

  /**
   * Đặt một tệp ĐÃ ĐÍNH KÈM task làm ảnh bìa: bật `file_links.is_primary` trên chính dòng đính kèm đó.
   *
   * KHÔNG tạo link mới, KHÔNG cấp quyền đọc tệp mới — đó là tính chất an toàn cốt lõi và nó là CẤU
   * TRÚC chứ không phải một lệnh kiểm: bìa CHÍNH LÀ dòng attachment, nên không tồn tại đường đặt bìa
   * bằng tệp chưa đính kèm, kể cả khi ai đó về sau quên một lệnh kiểm.
   *
   * Gate = `file-upload:task` (giống đính kèm/gỡ tệp, mode 'collab' ⇒ Viewer bị loại). Chọn cặp này
   * chứ không phải `update:task`: ai đính kèm/xoá được tệp thì chọn tệp nào làm bìa KHÔNG phải leo
   * thang; ngược lại người có `update:task` mà không có `file-upload` thì chẳng có tệp nào để chọn.
   */
  async setCover(user: RequestUser, taskId: string, fileId: string): Promise<TaskFileDto> {
    await this.assertScope(user, taskId, ACTION_UPLOAD);
    const row = await this.loadLinkedFileOr404(user, taskId, fileId); // cross-task/cross-tenant ⇒ 404

    if (!row.mimeType.startsWith("image/")) {
      throw new UnsupportedMediaTypeException({
        code: FOUNDATION_FILE_ERROR_CODES.MIME,
        message: `${FOUNDATION_FILE_ERROR_CODES.MIME}: ảnh bìa phải là ảnh (mime hiện tại: ${row.mimeType}).`,
      });
    }
    if (row.uploadStatus !== "Uploaded") {
      throw new ConflictException({
        code: FOUNDATION_FILE_ERROR_CODES.NOT_PENDING,
        message: `${FOUNDATION_FILE_ERROR_CODES.NOT_PENDING}: tệp chưa upload xong.`,
      });
    }
    // Ngưỡng CHẶT (Clean|NotRequired), giống getDownloadUrl — bìa hiển thị cho MỌI người đọc task nên
    // không được lỏng hơn đường tải.
    if (!DOWNLOADABLE_SCAN.has(row.scanStatus)) {
      throw new ConflictException({
        code: FOUNDATION_FILE_ERROR_CODES.NOT_DOWNLOADABLE,
        message: `${FOUNDATION_FILE_ERROR_CODES.NOT_DOWNLOADABLE}: tệp chưa quét sạch (scan_status=${row.scanStatus}).`,
      });
    }

    let changed = false;
    try {
      changed = await this.db.withTenant(user.companyId, async (tx) => {
        // Kiểm ĐỘC QUYỀN trong tx: tệp còn link sống ở entity khác ⇒ không dùng làm bìa được. Đường ĐỌC
        // cũng ép lại vị từ này (đó mới là chốt); ở đây chỉ để người dùng biết NGAY thay vì đặt xong rồi
        // ngồi nhìn thẻ không hiện gì. Lệch TOCTOU giữa hai chỗ chấp nhận được — đọc tái kiểm mỗi lần.
        const otherLinks = await this.repo.countOtherLiveLinksTx(tx, taskId, fileId);
        if (otherLinks > 0) {
          throw new ConflictException({
            code: TASK_COVER_SHARED_CODE,
            message: `${TASK_COVER_SHARED_CODE}: tệp đang được gắn ở nơi khác nên không dùng làm ảnh bìa được.`,
          });
        }

        // Khoá theo TASK. `FOR UPDATE` trong findPrimaryLinkTx không đủ một mình: task CHƯA có bìa thì
        // không có hàng nào để khoá, hai người cùng đặt bìa đầu tiên sẽ cùng đi tới nâng cờ ⇒ 23505.
        // xact-level (không phải session) là bắt buộc trên PgBouncer transaction-mode.
        await tx.execute(
          sql`select pg_advisory_xact_lock(${ADVISORY_CLASS_TASK_COVER}, hashtext(${taskId}::text))`,
        );

        const current = await this.repo.findPrimaryLinkTx(tx, user.companyId, taskId);
        if (current?.linkId === row.linkId) return false; // đã là bìa ⇒ no-op idempotent

        // Hạ bìa cũ TRƯỚC khi nâng bìa mới, trong CÙNG tx: unique index không bao giờ thấy 2 primary.
        if (current) {
          await this.repo.setPrimaryTx(tx, user.companyId, current.linkId, false);
          // Audit CHO CẢ link bị HẠ. Bỏ vế này là để lại đúng thứ docblock recordCoverAudit nói nó tồn
          // tại để chặn: một mutation is_primary true→false trên file_links không ai truy được.
          await this.recordCoverAudit(tx, user, current.linkId, current.fileId, taskId, false);
        }
        await this.repo.setPrimaryTx(tx, user.companyId, row.linkId, true);

        await this.recordCoverAudit(tx, user, row.linkId, fileId, taskId, true);
        return true;
      });
    } catch (err) {
      // ConflictException của vế ĐỘC QUYỀN ở trên đi thẳng qua đây (không phải lỗi pg) —
      // rethrowAsConflict chỉ đổi mã cho va chạm đồng thời, còn lại propagate nguyên vẹn.
      rethrowAsConflict(err);
    }

    // Chỉ ghi activity khi CÓ ĐỔI THẬT (đặt lại chính bìa hiện tại là no-op). `task_activity_logs`
    // append-only ⇒ ghi lúc no-op làm phình bảng + nhiễu feed bằng sự kiện không có thay đổi nào.
    if (changed) {
      await this.recordActivity(
        user,
        taskId,
        fileId,
        "TASK_COVER_SET",
        "Đặt ảnh bìa cho công việc",
      );
    }

    // Reload SAU khi lật cờ — row ở trên load TRƯỚC update nên sẽ mang isCover=false, sai ngay tại
    // chính lời gọi vừa đặt bìa.
    const fresh = await this.loadLinkedFileOr404(user, taskId, fileId);
    return this.toDto(fresh);
  }

  /** Gỡ ảnh bìa. Idempotent: task chưa có bìa ⇒ no-op, KHÔNG 404 (gỡ thứ không có là thành công). */
  async clearCover(user: RequestUser, taskId: string): Promise<void> {
    await this.assertScope(user, taskId, ACTION_UPLOAD);
    let changed = false;
    try {
      changed = await this.db.withTenant(user.companyId, async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${ADVISORY_CLASS_TASK_COVER}, hashtext(${taskId}::text))`,
        );
        const current = await this.repo.findPrimaryLinkTx(tx, user.companyId, taskId);
        if (!current) return false;
        await this.repo.setPrimaryTx(tx, user.companyId, current.linkId, false);
        await this.recordCoverAudit(tx, user, current.linkId, current.fileId, taskId, false);
        return true;
      });
    } catch (err) {
      rethrowAsConflict(err);
    }
    // Chỉ ghi activity khi CÓ ĐỔI THẬT. `task_activity_logs` là append-only: ghi cả lúc no-op
    // (gỡ bìa của task vốn không có bìa) làm phình bảng và nhiễu feed hoạt động bằng sự kiện không
    // tương ứng thay đổi nào.
    if (changed) {
      await this.recordActivity(
        user,
        taskId,
        undefined,
        "TASK_COVER_CLEARED",
        "Gỡ ảnh bìa công việc",
      );
    }
  }

  /**
   * Audit cho mutate `file_links` — BẮT BUỘC, không phải trang trí.
   *
   * Mọi writer khác của bảng này đều ghi audit (`FileService.link` → FileLinked, `unlink` →
   * FileUnlinked). Nếu đường bìa chỉ ghi `task_activity_logs` thì trail audit của `file_links` có một
   * đường ghi VÔ HÌNH — cờ đổi mà không ai truy được ai đổi.
   *
   * KHÔNG cần migration: `audit_logs.action` là text tự do và `object_type='file_link'` đã nằm trong
   * CHECK (mig `0440_file1_audit_object_type.sql`).
   */
  private async recordCoverAudit(
    tx: TenantTx,
    user: RequestUser,
    linkId: string,
    fileId: string,
    taskId: string,
    isPrimary: boolean,
  ): Promise<void> {
    await this.audit.record(tx, {
      action: "FileLinkPrimaryChanged",
      objectType: "file_link",
      objectId: linkId,
      actorUserId: user.id,
      actorType: "User",
      moduleCode: TASK_MODULE,
      entityType: TASK_ENTITY,
      entityId: taskId,
      resultStatus: "Success",
      dataScope: "Company",
      before: { isPrimary: !isPrimary },
      after: { isPrimary, fileId },
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * FINE data_scope narrowing over the target task. resolveAndAssert throws Forbidden only when the caller
   * has NO grant (already gated by PermissionGuard on the route, so normally passes). Then check task-in-scope
   * inside the tenant tx — out-of-scope / cross-tenant (RLS 0-row) / not-found ⇒ 404 (never 403-after-200,
   * never leak existence).
   */
  private async assertScope(user: RequestUser, taskId: string, action: string): Promise<void> {
    const scope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      action,
      TASK_RESOURCE,
    );
    // S5-TASK-PROJROLE-1 (D-24): mode suy từ action — XEM/tải ('read', mọi member kể cả Viewer);
    // upload/xoá file ('collab', role ≥ Member — Viewer chỉ đọc). Helper phục vụ cả 2 lớp nên mode
    // theo operation, không gán cứng (BLOCKING #1 plan-reviewer).
    const mode: TaskScopeMode = action === ACTION_READ ? "read" : "collab";
    const inScope = await this.db.withTenant(user.companyId, async (tx) => {
      let scopeExists: SQL | undefined;
      if (scope !== "Company" && scope !== "System") {
        const ctx = await this.dataScope.resolveContext(user.id, user.companyId);
        const scopeCond = this.dataScope.buildEmployeeScopeCondition(scope, ctx);
        const actorEmp = await this.coreRepo.findActiveEmployeeByUserTx(
          tx,
          user.companyId,
          user.id,
        );
        scopeExists = this.coreRepo.buildReadScopeExists(
          user.companyId,
          scopeCond,
          actorEmp?.id ?? null,
          user.id,
          mode,
        );
      }
      return this.repo.isTaskInScopeTx(tx, user.companyId, taskId, scopeExists);
    });
    if (!inScope) throw new NotFoundException(ERR_TASK_NOT_FOUND);
  }

  /** Load the one file linked to `taskId` (soft-delete filtered) or 404 (cross-task/gone/leak). */
  private async loadLinkedFileOr404(
    user: RequestUser,
    taskId: string,
    fileId: string,
  ): Promise<TaskFileRow> {
    const row = await this.db.withTenant(user.companyId, (tx) =>
      this.repo.findLinkedFileTx(tx, user.companyId, taskId, fileId),
    );
    if (!row) throw new NotFoundException(ERR_FILE_NOT_FOUND);
    return row;
  }

  /**
   * Append a TASK_FILE_* row (target_type 'File') to task_activity_logs (BẤT BIẾN #2 append-only). Runs in
   * its own withTenant tx AFTER the FileService operation committed — the activity feed is not a ledger
   * invariant, so a separate tx is acceptable (still tenant-scoped + append-only).
   */
  private async recordActivity(
    user: RequestUser,
    taskId: string,
    fileId: string | undefined,
    action: "TASK_FILE_UPLOADED" | "TASK_FILE_DELETED" | "TASK_COVER_SET" | "TASK_COVER_CLEARED",
    message: string,
  ): Promise<void> {
    await this.db.withTenant(user.companyId, async (tx: TenantTx) => {
      const actorEmp = await this.coreRepo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
      // S5-TASK-WORKSPACE-1: projectId PHẢI đi kèm (mirror TASK_WATCHER_*) — feed dự án TASK-API-601
      // lọc theo project_id; thiếu là sự kiện file biến mất khỏi tab Hoạt động của workspace.
      const raw = await this.coreRepo.findRawByIdTx(tx, user.companyId, taskId);
      await this.activity.record(tx, {
        action,
        targetType: "File",
        // Gỡ bìa không trỏ tệp cụ thể (bìa cũ có thể đã bị xoá) ⇒ targetId null, vẫn giữ targetType
        // "File" cho khớp CHECK chk_task_activity_target_type.
        targetId: fileId ?? null,
        taskId,
        projectId: raw?.projectId ?? null,
        actorUserId: user.id,
        actorEmployeeId: actorEmp?.id ?? null,
        message,
      });
    });
  }

  private toDto(row: TaskFileRow): TaskFileDto {
    return {
      linkId: row.linkId,
      fileId: row.fileId,
      originalName: row.originalName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      scanStatus: row.scanStatus as TaskFileDto["scanStatus"],
      uploadStatus: row.uploadStatus as TaskFileDto["uploadStatus"],
      uploadedAt: row.uploadedAt.toISOString(),
      category: row.category,
      isCover: row.isCover ?? false,
    };
  }
}
