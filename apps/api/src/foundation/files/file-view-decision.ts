import type { FileLink } from "../../db/schema/files";
import type { FileLinkRef, FilePermissionInput, FilePolicyAction } from "./file-policy.types";

/**
 * S19-SEC-FILEMETAGATE-1 — đầu vào DUY NHẤT của quyết định truy cập tệp FOUNDATION.
 *
 * `FileService` (theo id · tải · xoá · gắn/gỡ link) và `FileListService` (danh sách) cùng dựng đầu vào
 * cho `FilePolicyService.decideForLinkedFile` bằng các hàm thuần ở đây ⇒ «hàng danh sách có tên ⇔
 * `GET /foundation/files/:id` cùng người gọi = 200» là MỘT vị từ, không phải hai bản chép có thể trôi.
 * Không truy cập DB, không mang storage_path/checksum (CLAUDE.md §2.3).
 */

/** Module/entity của tệp không gắn thực thể nghiệp vụ nào (tệp FOUNDATION tự thân). */
export const FOUNDATION_FILE_MODULE = "FOUNDATION";
export const FOUNDATION_FILE_ENTITY = "File";

/** Người gọi đã xác thực (JwtAuthGuard + CompanyGuard). */
export interface FileDecisionActor {
  id: string;
  companyId: string;
}

/** Dựng FilePermissionInput tường minh (đủ kiểu, không cast) cho dispatch resolver/fallback. */
export function filePolicyInput(
  user: FileDecisionActor,
  parts: {
    fileId: string;
    moduleCode: string;
    entityType: string;
    entityId: string;
    action: FilePolicyAction;
  },
): FilePermissionInput {
  return {
    companyId: user.companyId,
    userId: user.id,
    fileId: parts.fileId,
    moduleCode: parts.moduleCode,
    entityType: parts.entityType,
    entityId: parts.entityId,
    action: parts.action,
  };
}

/** Đầu vào cho quyết định trên chính tệp (khuôn FOUNDATION/File) — dùng chung cho mọi đường đọc theo tệp. */
export function fileSelfPolicyInput(
  user: FileDecisionActor,
  fileId: string,
  action: FilePolicyAction,
): FilePermissionInput {
  return filePolicyInput(user, {
    fileId,
    moduleCode: FOUNDATION_FILE_MODULE,
    entityType: FOUNDATION_FILE_ENTITY,
    entityId: fileId,
    action,
  });
}

/**
 * S2-FND-BE-4 (H1) — map một hàng `file_links` sang FileLinkRef tối thiểu mà policy dispatch. Chỉ khoá
 * dispatch + thực thể đi tới policy (không storage_path / secret — #2.3).
 */
export function toFileLinkRef(link: FileLink): FileLinkRef {
  return {
    moduleCode: link.moduleCode,
    entityType: link.entityType,
    entityId: link.entityId,
  };
}
