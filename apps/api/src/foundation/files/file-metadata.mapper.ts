import type { FileLinkDto, FileListItemDto, FileMetadataDto } from "@mediaos/contracts";
import type { FileLink, FileRecord } from "../../db/schema/files";

/**
 * Hàm thuần map hàng `files` → DTO an toàn (BẤT BIẾN #2.3 — KHÔNG storage_path/checksum/storedName).
 *
 * S19-SEC-FILEMETAGATE-1 — tách khỏi `FileService` để đường theo id và đường danh sách dùng CHUNG một
 * mapper: hàng danh sách được phép = đúng DTO theo id (links rỗng); hàng không được phép che tên · đuôi ·
 * cỡ · chủ tệp, giữ phần còn lại.
 */
export function toFileMetadataDto(row: FileRecord, links: readonly FileLink[]): FileMetadataDto {
  return {
    id: row.id,
    originalName: row.originalName,
    mimeType: row.mimeType,
    fileExtension: row.fileExtension ?? null,
    sizeBytes: row.fileSizeBytes,
    visibility: row.visibility as FileMetadataDto["visibility"],
    uploadStatus: row.uploadStatus as FileMetadataDto["uploadStatus"],
    scanStatus: row.scanStatus as FileMetadataDto["scanStatus"],
    uploadedAt: row.uploadedAt.toISOString(),
    downloadCount: row.downloadCount,
    ownerUserId: row.ownerUserId ?? null,
    isTemporary: row.isTemporary,
    links: links.map((l) => ({
      id: l.id,
      moduleCode: l.moduleCode,
      entityType: l.entityType,
      entityId: l.entityId,
      linkType: l.linkType as FileLinkDto["linkType"],
      accessScope: l.accessScope as FileLinkDto["accessScope"],
      isPrimary: l.isPrimary,
    })),
  };
}

/**
 * Một hàng của danh sách tệp. `canView` = quyết định XEM của chính người gọi cho tệp này (cùng vị từ với
 * `GET /foundation/files/:id`). Danh sách không eager-load link (`links: []`).
 */
export function toFileListItemDto(row: FileRecord, canView: boolean): FileListItemDto {
  const dto = toFileMetadataDto(row, []);
  if (canView) return dto;
  return { ...dto, originalName: null, fileExtension: null, sizeBytes: null, ownerUserId: null };
}
