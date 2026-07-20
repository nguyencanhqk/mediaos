import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { sql, type SQL } from "drizzle-orm";
import { type TenantTx } from "../db/db.service";
import { fileLinks, files } from "../db/schema";

/**
 * S4-TASK-BE-5 — read-only persistence for TASK files (đính kèm công việc). The FILE lifecycle
 * (upload/soft-delete) is owned by Foundation FileService (files/file_links); this repo only READS the
 * polymorphic join (module_code='TASK', entity_type='task', entity_id=taskId) so the task surface can list a
 * task's attachments and resolve one file for metadata/download/scan-guard. It ALSO answers the "is this task
 * in the actor's read scope?" predicate (isTaskInScopeTx) used by the resolver + service IDOR guard.
 *
 * Mirrors employee-file.repository EXACTLY (safe join fields only — NO storage_path/checksum). Every method
 * runs INSIDE the caller's tenant tx (withTenant → RLS+FORCE); each WHERE also ANDs company_id
 * (defense-in-depth, BẤT BIẾN #1). Soft-deleted rows are excluded (BẤT BIẾN #2): a link whose
 * file_links.deleted_at OR files.deleted_at is set never appears — proves DELETE removed it without hard-delete.
 */

/** module_code / entity_type MUST match what TaskFileService passes to FileService.link. */
export const TASK_MODULE = "TASK";
export const TASK_ENTITY = "task";

/**
 * S5-TASK-COVER-1 — link_type của ảnh bìa. LÀ `'Attachment'`, KHÔNG PHẢI `'Cover'`.
 *
 * `'Cover'` KHÔNG tồn tại: CHECK `chk_file_links_link_type` (mig 0433:159) chỉ nhận
 * Avatar/Attachment/Contract/Proof/Document/Import/Export/Other, và `FILE_LINK_TYPE_VALUES`
 * (contracts) mirror y hệt. Ảnh bìa = chính dòng đính kèm được bật `is_primary`; unique index
 * `uq_file_links_primary_per_entity_type` (0433:174) ép sẵn tối đa MỘT bìa cho mỗi (task, link_type).
 * Hằng riêng (không dùng literal rải rác) để đường ghi ở đây và đường đọc ở
 * `FileRepository.findVerifiedTaskCoversTx` không bao giờ trôi khỏi nhau.
 */
export const COVER_LINK_TYPE = "Attachment";

/** A joined file_links⋈files row surfaced to the service (safe fields only — no storage_path/checksum). */
export interface TaskFileRow {
  linkId: string;
  fileId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  scanStatus: string;
  uploadStatus: string;
  uploadedAt: Date;
  category: string | null;
  /** S5-TASK-COVER-1 — tệp này đang là ảnh bìa (đã qua ĐỦ điều kiện hợp lệ, không phải cờ thô). */
  isCover: boolean;
}

const FILE_COLUMNS = {
  linkId: fileLinks.id,
  fileId: files.id,
  originalName: files.originalName,
  mimeType: files.mimeType,
  sizeBytes: files.fileSizeBytes,
  scanStatus: files.scanStatus,
  uploadStatus: files.uploadStatus,
  uploadedAt: files.uploadedAt,
  category: fileLinks.purpose,
  /**
   * S5-TASK-COVER-1 — `isCover` là BIỂU THỨC TRONG SELECT, cố ý KHÔNG phải điều kiện trong WHERE.
   *
   * Nhét các vế này vào WHERE của `listLinkedFilesByTaskTx` sẽ làm MỌI tệp không-phải-ảnh BIẾN MẤT
   * khỏi danh sách đính kèm — panel Tệp trống trơn trong khi người dùng vừa upload xong.
   *
   * Điều kiện phải KHỚP `FileRepository.findVerifiedTaskCoversTx` (đường ký), kể cả vị từ ĐỘC QUYỀN:
   * lệch nhau là panel nói "đang là ảnh bìa" mà thẻ board không hiện gì — không lỗi, không manh mối.
   */
  isCover: sql<boolean>`(
    ${fileLinks.isPrimary}
    and ${fileLinks.linkType} = ${COVER_LINK_TYPE}
    and ${files.uploadStatus} = 'Uploaded'
    and ${files.scanStatus} in ('Clean','NotRequired')
    and ${files.mimeType} like 'image/%'
    and not exists (
      select 1 from file_links fl2
      where fl2.file_id = ${files.id}
        and fl2.deleted_at is null
        and not (fl2.module_code = ${TASK_MODULE}
                 and fl2.entity_type = ${TASK_ENTITY}
                 and fl2.entity_id = ${fileLinks.entityId})
    )
  )`,
} as const;

@Injectable()
export class TaskFileRepository {
  /**
   * List a task's linked files (soft-delete filtered on BOTH file_links and files), newest first.
   * `category` (optional) filters on file_links.purpose. RLS + explicit company_id keep it tenant-bound.
   */
  async listLinkedFilesByTaskTx(
    tx: TenantTx,
    companyId: string,
    taskId: string,
    category?: string,
  ): Promise<TaskFileRow[]> {
    const conds = [
      eq(fileLinks.companyId, companyId),
      eq(fileLinks.moduleCode, TASK_MODULE),
      eq(fileLinks.entityType, TASK_ENTITY),
      eq(fileLinks.entityId, taskId),
      isNull(fileLinks.deletedAt),
      isNull(files.deletedAt),
    ];
    if (category) conds.push(eq(fileLinks.purpose, category));

    const rows = await tx
      .select(FILE_COLUMNS)
      .from(fileLinks)
      .innerJoin(files, eq(fileLinks.fileId, files.id))
      .where(and(...conds))
      .orderBy(desc(files.uploadedAt));
    return rows as TaskFileRow[];
  }

  /**
   * Resolve ONE file that is BOTH linked to `taskId` AND still live (link + file not soft-deleted).
   * Returns undefined when the file is not linked to THIS task (cross-task IDOR) or cross-tenant (RLS 0-row)
   * — the service maps that to 404 (no oracle). Carries scanStatus/uploadStatus for the download scan-guard.
   */
  async findLinkedFileTx(
    tx: TenantTx,
    companyId: string,
    taskId: string,
    fileId: string,
  ): Promise<TaskFileRow | undefined> {
    const [row] = await tx
      .select(FILE_COLUMNS)
      .from(fileLinks)
      .innerJoin(files, eq(fileLinks.fileId, files.id))
      .where(
        and(
          eq(fileLinks.companyId, companyId),
          eq(fileLinks.moduleCode, TASK_MODULE),
          eq(fileLinks.entityType, TASK_ENTITY),
          eq(fileLinks.entityId, taskId),
          eq(fileLinks.fileId, fileId),
          isNull(fileLinks.deletedAt),
          isNull(files.deletedAt),
        ),
      )
      .limit(1);
    return row as TaskFileRow | undefined;
  }

  /**
   * S5-TASK-BE-6 — attachment count GROUPED by `entity_id` (taskId) for EVERY task in `taskIds` (1 query,
   * NO N+1 — Kanban board). Filters BOTH `file_links.deletedAt` AND `files.deletedAt` (mirror
   * listLinkedFilesByTaskTx) so a soft-deleted link or a soft-deleted file never inflates the count. Empty
   * `taskIds` ⇒ empty Map (skip the round-trip for a project with 0 tasks).
   */
  async countByTaskIdsTx(
    tx: TenantTx,
    companyId: string,
    taskIds: string[],
  ): Promise<Map<string, number>> {
    if (taskIds.length === 0) return new Map();
    const rows = await tx
      .select({ taskId: fileLinks.entityId, n: sql<number>`count(*)::int` })
      .from(fileLinks)
      .innerJoin(files, eq(fileLinks.fileId, files.id))
      .where(
        and(
          eq(fileLinks.companyId, companyId),
          eq(fileLinks.moduleCode, TASK_MODULE),
          eq(fileLinks.entityType, TASK_ENTITY),
          inArray(fileLinks.entityId, taskIds),
          isNull(fileLinks.deletedAt),
          isNull(files.deletedAt),
        ),
      )
      .groupBy(fileLinks.entityId);
    return new Map(rows.map((r) => [r.taskId, Number(r.n)]));
  }

  /**
   * TRUE iff a live task `taskId` exists in this tenant AND (when `scopeExists` is provided) matches the
   * actor's read-scope predicate (assignee-in-scope OR active project-member — built by
   * TaskCoreRepository.buildReadScopeExists). Company/System scope ⇒ caller passes no `scopeExists` ⇒ any
   * live in-tenant task matches. Not found / cross-tenant RLS 0-row / out-of-scope ⇒ false ⇒ fail-closed
   * (404 in the service, deny in the resolver). Correlate outer alias `tk` (matches buildReadScopeExists).
   */
  async isTaskInScopeTx(
    tx: TenantTx,
    companyId: string,
    taskId: string,
    scopeExists?: SQL,
  ): Promise<boolean> {
    const conds: SQL[] = [
      sql`tk.id = ${taskId}`,
      sql`tk.company_id = ${companyId}`,
      sql`tk.deleted_at is null`,
    ];
    if (scopeExists) conds.push(scopeExists);
    const where = sql.join(conds, sql` and `);
    const res = await tx.execute(sql`select 1 from tasks tk where ${where} limit 1`);
    return res.rows.length > 0;
  }

  // ── S5-TASK-COVER-1: ảnh bìa = dòng Attachment của task được bật `is_primary` ─────────────────

  /**
   * Dòng link đang là ẢNH BÌA của task (nếu có) — để hạ cờ trước khi nâng bìa mới.
   *
   * ⚠️ **CHỈ truy vấn `file_links`. CẤM join `files`, CẤM lọc mime/upload_status/scan_status.**
   * Đây không phải chuyện gọn code — nó là điều kiện đúng/sai. `TaskFileService.delete` chỉ
   * soft-delete bảng **`files`** (`FileService.deleteFile`), **dòng `file_links` vẫn sống với
   * `is_primary = true`**. Nếu ai đó "tiện tay" nhân bản truy vấn đường-đọc (`findVerifiedTaskCoversTx`,
   * vốn có join `files` + lọc `files.deleted_at`) vào đây, thì primary MỒ CÔI đó trở nên **vô hình**
   * ⇒ đặt bìa mới không hạ được nó ⇒ đụng `uq_file_links_primary_per_entity_type` ⇒ **23505 → 500,
   * mọi lần**. Đường ĐỌC lọc chặt để không HIỂN THỊ; đường DỌN phải thấy MỌI thứ để HẠ CỜ.
   *
   * `FOR UPDATE` khoá hàng primary hiện tại — tuần tự hoá hai người cùng đổi bìa. (Không đủ một mình:
   * hàng CHƯA tồn tại thì không khoá được gì — service còn lấy thêm advisory lock.)
   */
  async findPrimaryLinkTx(
    tx: TenantTx,
    companyId: string,
    taskId: string,
  ): Promise<{ linkId: string; fileId: string } | undefined> {
    const [row] = await tx
      .select({ linkId: fileLinks.id, fileId: fileLinks.fileId })
      .from(fileLinks)
      .where(
        and(
          eq(fileLinks.companyId, companyId),
          eq(fileLinks.moduleCode, TASK_MODULE),
          eq(fileLinks.entityType, TASK_ENTITY),
          eq(fileLinks.entityId, taskId),
          eq(fileLinks.linkType, COVER_LINK_TYPE),
          eq(fileLinks.isPrimary, true),
          isNull(fileLinks.deletedAt),
        ),
      )
      .limit(1)
      .for("update");
    return row;
  }

  /** Lật cờ bìa trên MỘT dòng link. Company-scoped + bỏ qua link đã soft-delete. */
  async setPrimaryTx(
    tx: TenantTx,
    companyId: string,
    linkId: string,
    isPrimary: boolean,
  ): Promise<void> {
    await tx
      .update(fileLinks)
      // Schema `file_links` KHÔNG có cột updated_at — chỉ set đúng cờ.
      .set({ isPrimary })
      .where(
        and(
          eq(fileLinks.id, linkId),
          eq(fileLinks.companyId, companyId),
          isNull(fileLinks.deletedAt),
        ),
      );
  }

  /**
   * Đếm link SỐNG của `fileId` ở BẤT KỲ entity nào KHÁC task này (>0 ⇒ từ chối đặt làm bìa).
   *
   * ⚠️ PHẢI KHỚP LOGIC với vị từ `NOT EXISTS` trong `FileRepository.findVerifiedTaskCoversTx`. Lệch
   * nhau là bìa "đặt được nhưng không bao giờ hiện": `setCover` cho qua, đường đọc lại từ chối ký —
   * người dùng bấm xong thấy không có gì xảy ra, không lỗi, không manh mối.
   *
   * ⚠️ KHÔNG thêm điều kiện lọc nào khác (nhất là `company_id`): mọi điều kiện thêm vào chỉ làm ẩn
   * bớt link đếm được ⇒ nới lỏng bảo vệ. RLS đã lo phần tenant.
   */
  async countOtherLiveLinksTx(tx: TenantTx, taskId: string, fileId: string): Promise<number> {
    const res = await tx.execute(sql`
      select count(*)::int as n
      from file_links fl
      where fl.file_id = ${fileId}
        and fl.deleted_at is null
        and not (fl.module_code = ${TASK_MODULE}
                 and fl.entity_type = ${TASK_ENTITY}
                 and fl.entity_id = ${taskId})
    `);
    return Number((res.rows[0] as { n: number } | undefined)?.n ?? 0);
  }
}
