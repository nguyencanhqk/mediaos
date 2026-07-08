import { z } from "zod";
import { fileScanStatusSchema, fileUploadStatusSchema } from "../files";

/**
 * S2-HR-EMPFILE-1 — Employee File (hồ sơ đính kèm nhân viên) DTOs. Source of truth: API-03 HR-API-801..805 /
 * DB-08 §8.7 (file_links) / SPEC-03. Cổng quyền: ('file-view'|'file-upload'|'file-delete','employee')
 * (seed mig 0477, hr/company-admin → Company). File thật quản lý bởi Foundation FileService (files/file_links);
 * module HR chỉ link/list/download/soft-delete qua polymorphic (module_code='HR', entity_type='employee_profile').
 *
 * DTO KHÔNG lộ storage internals (BẤT BIẾN #2.3): storagePath / storageBucket / checksumSha256 / storedName /
 * signedUrl dài hạn — composed từ FileMetadataDto CHỈ các trường an toàn. downloadUrl (khi tải) TTL-ngắn dùng
 * lại `downloadUrlSchema` (packages/contracts/src/files.ts).
 */

// ─── Input: link a file (đã upload+confirm ở Foundation) vào hồ sơ nhân viên ─────────────────────

export const linkEmployeeFileSchema = z.object({
  /** File đã register+PUT+confirm qua Foundation FileService (upload_status='Uploaded'). */
  fileId: z.string().uuid(),
  /**
   * Phân loại tài liệu (CCCD / Bằng cấp / Hợp đồng / Khác…). Lưu vào file_links.purpose. Tự do trong
   * giới hạn độ dài — KHÔNG hard-code danh mục ở đây (client tự đặt nhãn, mask không cần).
   */
  category: z.string().trim().min(1).max(100).optional(),
});
export type LinkEmployeeFileRequest = z.infer<typeof linkEmployeeFileSchema>;

// ─── Query: list file của 1 nhân viên ────────────────────────────────────────────────────────────

export const listEmployeeFilesQuerySchema = z.object({
  /** Lọc theo category (khớp file_links.purpose). Optional. */
  category: z.string().trim().min(1).max(100).optional(),
});
export type ListEmployeeFilesQuery = z.infer<typeof listEmployeeFilesQuerySchema>;

// ─── Response DTO: 1 file hồ sơ nhân viên (compose từ FileMetadataDto) ────────────────────────────

export const employeeFileDtoSchema = z.object({
  /** file_links.id — dùng cho tham chiếu link (unlink/audit). */
  linkId: z.string().uuid(),
  /** files.id. */
  fileId: z.string().uuid(),
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  scanStatus: fileScanStatusSchema,
  uploadStatus: fileUploadStatusSchema,
  uploadedAt: z.string().datetime(),
  /** file_links.purpose — nhãn phân loại tài liệu (nullable/absent nếu không đặt lúc link). */
  category: z.string().nullable().optional(),
});
export type EmployeeFileDto = z.infer<typeof employeeFileDtoSchema>;
