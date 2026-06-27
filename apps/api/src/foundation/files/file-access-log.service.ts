import { Injectable } from "@nestjs/common";
import type { TenantTx } from "../../db/db.service";
import { fileAccessLogs } from "../../db/schema/files";

/**
 * S1-FND-FILE-1 — writer cho `file_access_logs` (DB-08 §8.8). APPEND-ONLY (BẤT BIẾN #2): app role chỉ
 * GRANT SELECT,INSERT (REVOKE UPDATE/DELETE ở mig 0433) ⇒ class này CHỈ insert, KHÔNG update/delete log.
 *
 * Ghi CẢ nhánh DENY (access_granted=false + denied_reason) — log truy cập bị từ chối là yêu cầu QA-05.
 * PHẢI gọi BÊN TRONG cùng transaction nghiệp vụ (`withTenant`) để log + thay đổi nghiệp vụ cùng
 * commit/rollback (BẤT BIẾN #1). company_id điền tự động qua DEFAULT current_setting (ngữ cảnh tenant).
 *
 * KHÔNG ghi storage_path / signed_url / binary (BẤT BIẾN #2.3) — log chỉ chứa metadata không nhạy cảm
 * (action, access_granted, denied_reason, module/entity, request_id).
 */

/** Hành động truy cập file ∈ CHECK file_access_logs.action (DB-08 §8.8 / mig 0433). */
export type FileAccessAction =
  | "Upload"
  | "Download"
  | "Preview"
  | "Link"
  | "Unlink"
  | "Delete"
  | "GenerateSignedUrl";

/** 1 bản ghi truy cập file. company_id KHÔNG truyền — lấy từ ngữ cảnh tenant (DB DEFAULT). */
export interface FileAccessLogEntry {
  fileId: string;
  action: FileAccessAction;
  accessGranted: boolean;
  actorUserId?: string;
  fileLinkId?: string;
  moduleCode?: string;
  entityType?: string;
  entityId?: string;
  permissionCode?: string;
  /** BẮT BUỘC khi accessGranted=false (lý do DENY máy-đọc — KHÔNG nhạy cảm). */
  deniedReason?: string;
  requestId?: string;
}

@Injectable()
export class FileAccessLogService {
  /**
   * Append 1 dòng log truy cập file (BẤT BIẾN #2 — INSERT-only). Chạy trong `tx` tenant của caller.
   * deniedReason cắt 255 ký tự (cột varchar(255)) để không vỡ ràng buộc độ dài.
   */
  async record(tx: TenantTx, entry: FileAccessLogEntry): Promise<void> {
    await tx.insert(fileAccessLogs).values({
      fileId: entry.fileId,
      action: entry.action,
      accessGranted: entry.accessGranted,
      actorUserId: entry.actorUserId ?? null,
      fileLinkId: entry.fileLinkId ?? null,
      moduleCode: entry.moduleCode ?? null,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      permissionCode: entry.permissionCode ?? null,
      deniedReason: entry.deniedReason ? entry.deniedReason.slice(0, 255) : null,
      requestId: entry.requestId ?? null,
    });
  }
}
