import { Injectable } from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";
import { type TenantTx } from "../db/db.service";
import { fileLinks, files } from "../db/schema";
import { CANDIDATE_ENTITY, RECRUIT_MODULE } from "./recruit-candidate-file.resolver";

/**
 * S14-RECRUIT-FILEGRANT-1 — đọc-thuần join `file_links ⋈ files` cho tệp CV của MỘT ứng viên
 * (khuôn `EmployeeFileRepository`). Vòng đời tệp (upload/soft-delete/audit) do Foundation
 * `FileService` sở hữu; repo này chỉ TRA.
 *
 * ⚠️ VÌ SAO wrapper tự query thay vì gọi `GET /foundation/files`: `FileRepository.listTx` **bỏ qua**
 * `moduleCode/entityType/entityId` (plan §9 KI-a) ⇒ dùng lại nó là liệt kê MỌI tệp của tenant. Ở đây
 * ba cột đó nằm trong `WHERE`, nên danh sách đúng bằng tệp đã gắn vào ĐÚNG ứng viên này.
 *
 * Mọi method chạy TRONG tenant tx của caller (`withTenant` → RLS+FORCE); mỗi WHERE vẫn AND
 * `company_id` (phòng thủ nhiều lớp, BẤT BIẾN #1). Link/tệp xoá mềm KHÔNG bao giờ xuất hiện.
 */

/** Hàng join bó hẹp — KHÔNG có storage_path/checksum/storedName (BẤT BIẾN #2.3). */
export interface RecruitCandidateFileRow {
  linkId: string;
  fileId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  scanStatus: string;
  uploadStatus: string;
  uploadedAt: Date;
  purpose: string | null;
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
  purpose: fileLinks.purpose,
} as const;

@Injectable()
export class RecruitCandidateFileRepository {
  /** Tệp đã gắn vào ứng viên, mới nhất trước; lọc soft-delete trên CẢ `file_links` lẫn `files`. */
  async listByCandidateTx(
    tx: TenantTx,
    companyId: string,
    candidateId: string,
  ): Promise<RecruitCandidateFileRow[]> {
    const rows = await tx
      .select(FILE_COLUMNS)
      .from(fileLinks)
      .innerJoin(files, eq(fileLinks.fileId, files.id))
      .where(
        and(
          eq(fileLinks.companyId, companyId),
          // Vế thứ HAI của phòng-thủ-nhiều-lớp: RLS+FORCE trên `files` đã lọc hàng khác tenant, nhưng
          // docblock trên khẳng định "mỗi WHERE vẫn AND company_id" — thiếu vế này thì lời khẳng định
          // đó SAI về chính nó, và lớp belt-and-suspenders chỉ còn một vế (FULL gate LOW).
          eq(files.companyId, companyId),
          eq(fileLinks.moduleCode, RECRUIT_MODULE),
          eq(fileLinks.entityType, CANDIDATE_ENTITY),
          eq(fileLinks.entityId, candidateId),
          isNull(fileLinks.deletedAt),
          isNull(files.deletedAt),
        ),
      )
      .orderBy(desc(files.uploadedAt));
    return rows as RecruitCandidateFileRow[];
  }

  /**
   * Tệp `fileId` có đang link SỐNG vào ĐÚNG `candidateId` không — chốt chặn IDOR của đường tải
   * (plan §3.6). `undefined` ⇒ tệp thuộc ứng viên KHÁC, link đã gỡ, tệp đã xoá, hoặc khác tenant
   * (RLS 0 hàng) — service map cả bốn về **404** để không có oracle phân biệt.
   */
  async findLinkedFileTx(
    tx: TenantTx,
    companyId: string,
    candidateId: string,
    fileId: string,
  ): Promise<RecruitCandidateFileRow | undefined> {
    const [row] = await tx
      .select(FILE_COLUMNS)
      .from(fileLinks)
      .innerJoin(files, eq(fileLinks.fileId, files.id))
      .where(
        and(
          eq(fileLinks.companyId, companyId),
          eq(files.companyId, companyId), // xem ghi chú ở `listByCandidateTx`
          eq(fileLinks.moduleCode, RECRUIT_MODULE),
          eq(fileLinks.entityType, CANDIDATE_ENTITY),
          eq(fileLinks.entityId, candidateId),
          eq(fileLinks.fileId, fileId),
          isNull(fileLinks.deletedAt),
          isNull(files.deletedAt),
        ),
      )
      .limit(1);
    return row as RecruitCandidateFileRow | undefined;
  }
}
