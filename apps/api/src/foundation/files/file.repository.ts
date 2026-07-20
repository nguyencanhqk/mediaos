import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, like, ne, not, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { TenantTx } from "../../db/db.service";
import { fileLinks, files, type FileRecord, type NewFileRecord } from "../../db/schema/files";

/**
 * Taxonomy link avatar — KHỚP me.constants (ME_MODULE_CODE / ME_AVATAR_ENTITY_TYPE) + fileLinkTypeSchema.
 * Hardcode literal Ở ĐÂY vì foundation/files KHÔNG phụ thuộc module `me` (chiều phụ thuộc: me → foundation).
 * NGUỒN tạo link giờ có 2: MeAvatarService.setAvatar (self-service) VÀ HrEmployeeAvatarService.setEmployeeAvatar
 * (S5-HR-AVATAR-1, HR-managed — xem hr-employee-avatar.service.ts AVATAR_LINK_* mirror).
 */
const AVATAR_LINK_MODULE = "ME";
const AVATAR_LINK_ENTITY = "avatar";
const AVATAR_LINK_TYPE = "Avatar";

/** 1 avatar ĐÃ XÁC MINH (link ME/avatar hợp lệ + file image/Uploaded) — chỉ field cần để ký (KHÔNG vào DTO). */
export interface VerifiedAvatarMeta {
  /** employee_profiles.id (= file_links.entity_id) mà file này là avatar HỢP LỆ của. */
  employeeId: string;
  fileId: string;
  storagePath: string;
}

/**
 * S5-TASK-COVER-1 — taxonomy ảnh bìa công việc. KHÔNG có `link_type = 'Cover'`: giá trị đó KHÔNG nằm
 * trong CHECK `chk_file_links_link_type` (mig 0433:159 — chỉ Avatar/Attachment/Contract/Proof/Document/
 * Import/Export/Other). Ảnh bìa = chính dòng Attachment của task được bật `is_primary`; unique index
 * `uq_file_links_primary_per_entity_type` (0433:174) đã ép đúng MỘT bìa cho mỗi (task, link_type).
 * Hardcode literal Ở ĐÂY vì foundation/files KHÔNG phụ thuộc module `tasks` (chiều phụ thuộc: tasks → foundation).
 */
const COVER_LINK_MODULE = "TASK";
const COVER_LINK_ENTITY = "task";
const COVER_LINK_TYPE = "Attachment";

/** 1 ảnh bìa ĐÃ XÁC MINH — chỉ field cần để ký (KHÔNG vào DTO, KHÔNG bao giờ lộ storagePath ra ngoài). */
export interface VerifiedCoverMeta {
  /** tasks.id (= file_links.entity_id) mà file này là ảnh bìa HỢP LỆ của. */
  taskId: string;
  fileId: string;
  storagePath: string;
}

/**
 * S1-FND-FILE-1 — persistence cho `files` (DB-08 §8.6). MỌI method nhận `companyId` + `tx`: chạy BÊN
 * TRONG transaction `withTenant` của FileService (1 chốt tenant duy nhất, BẤT BIẾN #1). Lọc
 * `eq(company_id)` tường minh (defense-in-depth) DÙ RLS+FORCE (mig 0433) đã ép ở DB.
 *
 * BẤT BIẾN #2: KHÔNG hard-delete — `softDeleteTx` set `deleted_at`/`deleted_by` (app role có table-level
 * UPDATE trên `files` — mig 0433:117 `GRANT SELECT, INSERT, UPDATE ON files TO mediaos_app` — KHÔNG có
 * DELETE row). KHÔNG trả storage_path ra ngoài repo cho DTO; service map sang FileMetadataDto an toàn
 * (storage_path KHÔNG bao giờ leak — #2.3).
 */
@Injectable()
export class FileRepository {
  /** files chưa soft-delete của tenant theo id. undefined nếu không tồn tại / cross-tenant (RLS) / đã xoá. */
  async findByIdTx(
    companyId: string,
    fileId: string,
    tx: TenantTx,
  ): Promise<FileRecord | undefined> {
    const [row] = await tx
      .select()
      .from(files)
      .where(and(eq(files.companyId, companyId), eq(files.id, fileId), isNull(files.deletedAt)))
      .limit(1);
    return row;
  }

  /**
   * S5-ME-BE-5 (RECONCILE S5-HR-AVATAR-1) — batch tra AVATAR ĐÃ XÁC MINH theo fileIds (cho
   * AvatarPresignService ký thumbnail directory-class). SELF-DEFENDING (crown — KHÔNG tin cột `avatar_url`
   * đa-người-ghi): CHỈ trả file mà
   *   (a) có 1 file_links ME/avatar/Avatar SỐNG, VÀ
   *   (b) file image/* + Uploaded + non-Infected + chưa xoá (guard lại lần 2, phòng link cũ trỏ file đã đổi).
   *
   * Owner-check (defense-in-depth): `files.owner_user_id = file_links.created_by` — NGƯỜI TẠO LINK phải sở
   * hữu file (RECONCILE 2026-07-18, thay `= employee_profiles.user_id`). Bất biến ĐÚNG: "người TẠO link
   * avatar phải sở hữu file". Self-service (MeAvatarService.setAvatar): created_by=employee, owner=employee
   * ✓. HR-managed (HrEmployeeAvatarService.setEmployeeAvatar): created_by=HR, owner=HR ✓ (mở đường HR upload
   * hộ NV — owner cũ `=employee.user_id` sẽ CHẶN nhầm case này). Forge (ai đó gắn file NGƯỜI KHÁC làm avatar
   * mình): owner(victim) ≠ created_by(kẻ gắn) ⇒ loại — VẪN CHẶN. Bỏ JOIN employee_profiles (không còn cần).
   *
   * Trả kèm `employeeId` (= link.entity_id) để caller khớp ĐÚNG (employee, file) — B mượn fileId avatar của A
   * (đầu độc chéo) KHÔNG khớp (entity_id=A ≠ B) ⇒ KHÔNG ký cho B. Company-scoped + RLS. ids rỗng → [].
   */
  async findVerifiedAvatarsTx(
    companyId: string,
    fileIds: string[],
    tx: TenantTx,
  ): Promise<VerifiedAvatarMeta[]> {
    if (fileIds.length === 0) return [];
    return tx
      .select({
        employeeId: fileLinks.entityId,
        fileId: files.id,
        storagePath: files.storagePath,
      })
      .from(fileLinks)
      .innerJoin(files, eq(files.id, fileLinks.fileId))
      .where(
        and(
          eq(fileLinks.companyId, companyId),
          eq(fileLinks.moduleCode, AVATAR_LINK_MODULE),
          eq(fileLinks.entityType, AVATAR_LINK_ENTITY),
          eq(fileLinks.linkType, AVATAR_LINK_TYPE),
          isNull(fileLinks.deletedAt),
          eq(files.companyId, companyId),
          inArray(files.id, fileIds),
          isNull(files.deletedAt),
          eq(files.uploadStatus, "Uploaded"),
          ne(files.scanStatus, "Infected"),
          like(files.mimeType, "image/%"),
          eq(files.ownerUserId, fileLinks.createdBy),
        ),
      );
  }

  /**
   * S5-TASK-COVER-1 — batch tra ẢNH BÌA ĐÃ XÁC MINH theo `taskIds` (cho CoverPresignService ký).
   *
   * SELF-DEFENDING — KHÔNG tin `file_links.is_primary` một mình. Cột đó ĐA-NGƯỜI-GHI: `POST
   * /foundation/files/:id/links` (`files.controller.ts`) nhận `isPrimary` **verbatim** từ body và
   * `FileService.link` chỉ kiểm tenant + `scan_status !== 'Infected'` — KHÔNG kiểm mime, KHÔNG kiểm
   * upload_status. Nên mọi ràng buộc an toàn phải nằm Ở ĐÂY, đường ĐỌC, chứ không ở đường ghi.
   *
   * ⚠️ VỊ TỪ ĐỘC QUYỀN (`NOT EXISTS` bên dưới) là chốt CHỐNG LEO THANG ĐỌC, không phải tối ưu:
   * đường tải file thật đi qua `FilePolicy.decideForLinkedFile` = **AND khắt-khe-nhất trên MỌI link
   * sống của file**. Một file link CẢ vào HR/Employee CẢ vào task (ảnh chụp hợp đồng/CCCD dạng
   * image/jpeg) hôm nay **403 khi tải** vì HR resolver deny. Không có vị từ này, chính file đó sẽ
   * được ký và render làm ảnh bìa cho MỌI người đọc board. Có nó, tập "ai nhận được coverUrl" TRÙNG
   * KHÍT tập "ai tải được file đó qua task".
   *
   * ⚠️ TUYỆT ĐỐI KHÔNG thêm `fl2.company_id = $companyId` vào `NOT EXISTS`. Nhà này có phản xạ "AND
   * company_id tường minh dù đã có RLS" (đúng ở mệnh đề thường), nhưng trong một `NOT EXISTS` mỗi điều
   * kiện thêm vào `fl2` làm ẨN BỚT link nhìn thấy được ⇒ **fail-OPEN** — ngược hẳn ý định. RLS đã lo
   * phần tenant.
   *
   * Ngưỡng scan `Clean|NotRequired` (KHÔNG phải `<> 'Infected'`): khớp `DOWNLOADABLE_SCAN` của
   * `TaskFileService.getDownloadUrl`. Biên an toàn không được lỏng hơn đường tải mà nó thay thế.
   *
   * Trả kèm `taskId` (= link.entity_id) để caller khớp ĐÚNG (task, file). ids rỗng → [].
   */
  async findVerifiedTaskCoversTx(
    companyId: string,
    taskIds: string[],
    tx: TenantTx,
  ): Promise<VerifiedCoverMeta[]> {
    if (taskIds.length === 0) return [];
    const otherLink = alias(fileLinks, "fl2");
    return tx
      .select({
        taskId: fileLinks.entityId,
        fileId: files.id,
        storagePath: files.storagePath,
      })
      .from(fileLinks)
      .innerJoin(files, eq(files.id, fileLinks.fileId))
      .where(
        and(
          eq(fileLinks.companyId, companyId),
          eq(fileLinks.moduleCode, COVER_LINK_MODULE),
          eq(fileLinks.entityType, COVER_LINK_ENTITY),
          eq(fileLinks.linkType, COVER_LINK_TYPE),
          eq(fileLinks.isPrimary, true),
          isNull(fileLinks.deletedAt),
          inArray(fileLinks.entityId, taskIds),
          eq(files.companyId, companyId),
          isNull(files.deletedAt),
          eq(files.uploadStatus, "Uploaded"),
          inArray(files.scanStatus, ["Clean", "NotRequired"]),
          like(files.mimeType, "image/%"),
          // Vị từ độc quyền — xem docblock. KHÔNG thêm điều kiện nào khác vào `otherLink`.
          notExists(
            tx
              .select({ one: sql`1` })
              .from(otherLink)
              .where(
                and(
                  eq(otherLink.fileId, files.id),
                  isNull(otherLink.deletedAt),
                  not(
                    and(
                      eq(otherLink.moduleCode, COVER_LINK_MODULE),
                      eq(otherLink.entityType, COVER_LINK_ENTITY),
                      eq(otherLink.entityId, fileLinks.entityId),
                    )!,
                  ),
                ),
              ),
          ),
        ),
      );
  }

  /**
   * Insert 1 row metadata. company_id KHÔNG truyền trong values — DB DEFAULT current_setting điền (an
   * toàn PgBouncer); nhưng vẫn set tường minh từ `data.companyId` để khớp tenant ngữ cảnh. Trả row vừa tạo.
   */
  async insertTx(data: NewFileRecord, tx: TenantTx): Promise<FileRecord> {
    const [row] = await tx.insert(files).values(data).returning();
    if (!row) {
      throw new Error("FileRepository.insertTx: insert returned no row");
    }
    return row;
  }

  /**
   * Liệt kê files chưa xoá của tenant (mới nhất trước), có thể lọc theo upload/scope. Pagination ép ở
   * service (limit/offset). RLS-scoped — chỉ thấy tenant hiện tại.
   */
  async listTx(
    companyId: string,
    opts: { limit: number; offset: number; visibility?: string },
    tx: TenantTx,
  ): Promise<FileRecord[]> {
    const conds = [eq(files.companyId, companyId), isNull(files.deletedAt)];
    if (opts.visibility) conds.push(eq(files.visibility, opts.visibility));
    return tx
      .select()
      .from(files)
      .where(and(...conds))
      .orderBy(desc(files.uploadedAt))
      .limit(opts.limit)
      .offset(opts.offset);
  }

  /** Đếm files chưa xoá của tenant (cho meta.total của list). */
  async countTx(companyId: string, opts: { visibility?: string }, tx: TenantTx): Promise<number> {
    const conds = [eq(files.companyId, companyId), isNull(files.deletedAt)];
    if (opts.visibility) conds.push(eq(files.visibility, opts.visibility));
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(files)
      .where(and(...conds));
    return row?.count ?? 0;
  }

  /**
   * Soft-delete (BẤT BIẾN #2): set deleted_at=now + deleted_by + upload_status='Deleted'. CHỈ update khi
   * row còn (deleted_at IS NULL) ⇒ idempotent (xoá lại không đổi gì). Trả số row ảnh hưởng (0 = không
   * tồn tại / cross-tenant / đã xoá → service ném NotFound, tránh oracle).
   */
  async softDeleteTx(
    companyId: string,
    fileId: string,
    deletedBy: string,
    tx: TenantTx,
  ): Promise<number> {
    const updated = await tx
      .update(files)
      .set({ deletedAt: new Date(), deletedBy, uploadStatus: "Deleted" })
      .where(and(eq(files.companyId, companyId), eq(files.id, fileId), isNull(files.deletedAt)))
      .returning({ id: files.id });
    return updated.length;
  }

  /**
   * S2-FND-FILE-2 confirm — CHỈ chuyển Pending → Uploaded (guard `upload_status='Pending'` trong WHERE ⇒
   * idempotent + chống race: nếu đã Uploaded/Failed/Deleted thì 0 row). Persist checksum_sha256 + content_hash
   * (server tính từ bytes storage) + file_size_bytes (size THẬT đã verify khớp khai báo). Trả số row ảnh hưởng.
   * Grant app = table-level UPDATE (mig 0433:117) ⇒ được phép ghi các cột này.
   */
  async markUploadedTx(
    companyId: string,
    fileId: string,
    data: { checksumSha256: string; sizeBytes: number },
    tx: TenantTx,
  ): Promise<number> {
    const updated = await tx
      .update(files)
      .set({
        uploadStatus: "Uploaded",
        checksumSha256: data.checksumSha256,
        contentHash: data.checksumSha256,
        fileSizeBytes: data.sizeBytes,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(files.companyId, companyId),
          eq(files.id, fileId),
          isNull(files.deletedAt),
          eq(files.uploadStatus, "Pending"),
        ),
      )
      .returning({ id: files.id });
    return updated.length;
  }

  /**
   * S2-FND-FILE-2 confirm-fail — Pending → Failed + ghi lý do vào metadata (KHÔNG persist checksum). CHỈ
   * update khi còn Pending (idempotent). Trả số row ảnh hưởng (0 = đã đổi trạng thái ở nơi khác).
   */
  async markFailedTx(
    companyId: string,
    fileId: string,
    reason: string,
    tx: TenantTx,
  ): Promise<number> {
    const updated = await tx
      .update(files)
      .set({
        uploadStatus: "Failed",
        metadata: { confirmFailure: reason },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(files.companyId, companyId),
          eq(files.id, fileId),
          isNull(files.deletedAt),
          eq(files.uploadStatus, "Pending"),
        ),
      )
      .returning({ id: files.id });
    return updated.length;
  }

  /**
   * S2-FND-FILE-2 — tăng download_count + set last_accessed_at (best-effort thống kê tải). Gọi SAU khi
   * download đã ALLOW + state-guard qua. KHÔNG guard trạng thái ở đây (service đã guard). Trả số row.
   */
  async incrementDownloadCountTx(companyId: string, fileId: string, tx: TenantTx): Promise<number> {
    const updated = await tx
      .update(files)
      .set({
        downloadCount: sql`${files.downloadCount} + 1`,
        lastAccessedAt: new Date(),
      })
      .where(and(eq(files.companyId, companyId), eq(files.id, fileId), isNull(files.deletedAt)))
      .returning({ id: files.id });
    return updated.length;
  }
}
