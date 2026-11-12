import type { DatabaseService } from "../../db/db.service";
import type { FileAccessLogService } from "./file-access-log.service";
import type { FileRepository } from "./file.repository";
import type { FileDecisionActor } from "./file-view-decision";

/** Một dòng file_access_log DENY (access_granted=false + denied_reason). */
export interface FileDenyLogEntry {
  fileId: string;
  action: Parameters<FileAccessLogService["record"]>[1]["action"];
  permissionCode: string;
  reason: string;
  moduleCode?: string;
  entityType?: string;
  entityId?: string;
  fileLinkId?: string;
  /** `fileId` do client gửi, chưa nạp hàng: chỉ ghi khi hàng có trong tenant (FK của log kiểm vượt RLS). */
  unverifiedFileId?: boolean;
}

/** Ghi 1 dòng file_access_log DENY trong tx tenant RIÊNG (tách khỏi files.service.ts, thân hàm giữ nguyên). */
export async function logFileDeny(
  deps: { db: DatabaseService; fileRepo: FileRepository; accessLog: FileAccessLogService },
  user: FileDecisionActor,
  entry: FileDenyLogEntry,
): Promise<void> {
  const { db, fileRepo, accessLog } = deps;
  await db.withTenant(user.companyId, async (tx) => {
    if (entry.unverifiedFileId && !(await fileRepo.findByIdTx(user.companyId, entry.fileId, tx))) {
      return;
    }
    await accessLog.record(tx, {
      fileId: entry.fileId,
      action: entry.action,
      accessGranted: false,
      actorUserId: user.id,
      deniedReason: entry.reason,
      permissionCode: entry.permissionCode,
      moduleCode: entry.moduleCode,
      entityType: entry.entityType,
      entityId: entry.entityId,
      fileLinkId: entry.fileLinkId,
    });
  });
}
