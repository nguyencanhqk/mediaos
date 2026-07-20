import { z } from "zod";
import { fileScanStatusSchema, fileUploadStatusSchema } from "./files";

/**
 * S4-TASK-BE-5 — Task File (đính kèm công việc) DTOs. Source of truth: API-06 / DB-08 §8.7 (file_links) /
 * SPEC-06. Cổng quyền: ('read'|'file-upload'|'file-delete','task') (seed mig 0485, employee/manager/hr/
 * company-admin theo scope). File thật do Foundation FileService quản lý (files/file_links); module TASK chỉ
 * link/list/download/soft-delete qua polymorphic (module_code='TASK', entity_type='task').
 *
 * TÁI DÙNG NGUYÊN pattern S2-HR-EMPFILE-1 (employee-file) — KHÔNG bảng task_files riêng. DTO KHÔNG lộ storage
 * internals (BẤT BIẾN #2.3): storagePath / storageBucket / checksumSha256 / storedName / signedUrl dài hạn —
 * compose từ FileMetadataDto CHỈ các trường an toàn. downloadUrl (khi tải) TTL-ngắn dùng lại downloadUrlSchema
 * (packages/contracts/src/files.ts) → 302 redirect.
 */

// ─── Input: link a file (đã upload+confirm ở Foundation) vào công việc ───────────────────────────

export const linkTaskFileSchema = z.object({
  /** File đã register+PUT+confirm qua Foundation FileService (upload_status='Uploaded'). */
  fileId: z.string().uuid(),
  /**
   * Phân loại tài liệu (Attachment / Proof / Spec / Khác…). Lưu vào file_links.purpose. Tự do trong giới
   * hạn độ dài — KHÔNG hard-code danh mục (client tự đặt nhãn).
   */
  category: z.string().trim().min(1).max(100).optional(),
});
export type LinkTaskFileRequest = z.infer<typeof linkTaskFileSchema>;

// ─── Query: list file của 1 công việc ─────────────────────────────────────────────────────────────

export const listTaskFilesQuerySchema = z.object({
  /** Lọc theo category (khớp file_links.purpose). Optional. */
  category: z.string().trim().min(1).max(100).optional(),
});
export type ListTaskFilesQuery = z.infer<typeof listTaskFilesQuerySchema>;

// ─── Response DTO: 1 file đính kèm công việc (compose từ FileMetadataDto) ──────────────────────────

export const taskFileDtoSchema = z.object({
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
  /**
   * S5-TASK-COVER-1 — tệp này ĐANG là ảnh bìa của task.
   *
   * KHÔNG suy được từ `coverUrl` của task: `coverUrl` là URL ĐÃ KÝ, không đối chiếu ngược về `fileId`.
   * Server tính field này theo ĐÚNG bộ điều kiện của đường ký ảnh bìa (is_primary + ảnh + Uploaded +
   * scan sạch + độc quyền), KHÔNG phải `is_primary` thô — nếu chỉ đọc cờ thô thì panel sẽ hiện "đang
   * là ảnh bìa" trong khi board không hiện gì cả.
   *
   * `.optional()` + `.default(false)` để khớp `coverUrl` (cũng optional): FE mới gặp API cũ vẫn parse
   * được thay vì ném ZodError lúc chạy.
   */
  isCover: z.boolean().optional().default(false),
});
export type TaskFileDto = z.infer<typeof taskFileDtoSchema>;
