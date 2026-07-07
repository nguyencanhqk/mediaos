import { z } from "zod";

/**
 * FILE subsystem contracts — nguồn sự thật DTO cho FileService / Controller (S1-FND-FILE-1).
 *
 * BẤT BIẾN (CLAUDE.md §2):
 *   - DTO ra-ngoài TUYỆT ĐỐI KHÔNG lộ: storagePath / storageBucket / checksumSha256 /
 *     contentHash / storedName / storageProvider / signedUrl dài hạn.
 *   - downloadUrl chỉ là TTL-ngắn (expiresAt bắt buộc).
 *   - MIME allowlist KHÔNG hard-code ở đây — sống ở system_settings `file.allowed_mime_types`,
 *     validate tại service.
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

export const FILE_VISIBILITY_VALUES = ["Private", "Internal", "Public"] as const;
export type FileVisibility = (typeof FILE_VISIBILITY_VALUES)[number];
export const fileVisibilitySchema = z.enum(FILE_VISIBILITY_VALUES);

export const FILE_UPLOAD_STATUS_VALUES = ["Pending", "Uploaded", "Failed", "Deleted"] as const;
export type FileUploadStatus = (typeof FILE_UPLOAD_STATUS_VALUES)[number];
export const fileUploadStatusSchema = z.enum(FILE_UPLOAD_STATUS_VALUES);

export const FILE_SCAN_STATUS_VALUES = [
  "NotRequired",
  "Pending",
  "Clean",
  "Infected",
  "Failed",
] as const;
export type FileScanStatus = (typeof FILE_SCAN_STATUS_VALUES)[number];
export const fileScanStatusSchema = z.enum(FILE_SCAN_STATUS_VALUES);

/**
 * link_type ∈ Avatar/Attachment/Contract/Proof/Document/Import/Export/Other (DB-08 §8.7 CHECK).
 */
export const FILE_LINK_TYPE_VALUES = [
  "Avatar",
  "Attachment",
  "Contract",
  "Proof",
  "Document",
  "Import",
  "Export",
  "Other",
] as const;
export type FileLinkType = (typeof FILE_LINK_TYPE_VALUES)[number];
export const fileLinkTypeSchema = z.enum(FILE_LINK_TYPE_VALUES);

/**
 * access_scope ∈ Owner/Team/Department/Company/System (DB-08 §8.7 CHECK).
 */
export const FILE_ACCESS_SCOPE_VALUES = [
  "Owner",
  "Team",
  "Department",
  "Company",
  "System",
] as const;
export type FileAccessScope = (typeof FILE_ACCESS_SCOPE_VALUES)[number];
export const fileAccessScopeSchema = z.enum(FILE_ACCESS_SCOPE_VALUES);

// ─── Pagination helpers ────────────────────────────────────────────────────────

const PAGE_DEFAULT = 1;
const PAGE_LIMIT_DEFAULT = 20;
const PAGE_LIMIT_MAX = 100;

// ─── Input schemas ─────────────────────────────────────────────────────────────

/**
 * UploadFileInput — metadata kèm multipart binary khi upload.
 * Server KHÔNG tin `declaredMimeType` (tự detect bằng magic bytes); field này chỉ để tham khảo.
 * KHÔNG có storagePath / checksum / signedUrl.
 */
export const uploadFileInputSchema = z.object({
  /** Tên file gốc — trim + non-empty; normalize chống path traversal ở service. */
  originalName: z.string().trim().min(1).max(500),
  /** MIME type do client khai báo — server sẽ RE-DETECT, không tin mù quáng. */
  declaredMimeType: z.string().min(1).max(255),
  /** Kích thước byte (integer ≥ 0) — dùng để validate trước khi stream. */
  sizeBytes: z.number().int().nonnegative(),
  /** Mức độ hiển thị; mặc định Private (SPEC-01 §16.3). */
  visibility: fileVisibilitySchema.default("Private"),
  /** Mã module gốc (HR / ATT / LEAVE / TASK / FOUNDATION …). */
  moduleCode: z.string().min(1).max(50).optional(),
  /** Loại entity nghiệp vụ (Employee / LeaveRequest / Task …). */
  entityType: z.string().min(1).max(100).optional(),
  /** UUID entity nghiệp vụ — phải cùng company (validate ở service). */
  entityId: z.string().uuid().optional(),
});
export type UploadFileInput = z.infer<typeof uploadFileInputSchema>;

/**
 * LinkFileInput — gắn một file đã upload vào entity nghiệp vụ.
 */
export const linkFileInputSchema = z.object({
  fileId: z.string().uuid(),
  moduleCode: z.string().min(1).max(50),
  entityType: z.string().min(1).max(100),
  entityId: z.string().uuid(),
  linkType: fileLinkTypeSchema,
  /** Phạm vi truy cập mặc định Company (DB-08 §8.7). */
  accessScope: fileAccessScopeSchema.default("Company"),
  isPrimary: z.boolean().default(false),
  /** Mô tả mục đích link (avatar, contract, evidence…). */
  purpose: z.string().min(1).max(255).optional(),
});
export type LinkFileInput = z.infer<typeof linkFileInputSchema>;

/**
 * ListFilesQuery — phân trang + filter metadata file.
 * Dùng z.coerce để nhận query-string từ HTTP (?page=2&limit=50).
 * .catch fallback về default để list không bao giờ 400 vì tham số số rác.
 */
export const listFilesQuerySchema = z.object({
  page: z.coerce
    .number()
    .int()
    .catch(PAGE_DEFAULT)
    .transform((n) => Math.max(1, n))
    .default(PAGE_DEFAULT),
  limit: z.coerce
    .number()
    .int()
    .catch(PAGE_LIMIT_DEFAULT)
    .transform((n) => Math.min(PAGE_LIMIT_MAX, Math.max(1, n)))
    .default(PAGE_LIMIT_DEFAULT),
  moduleCode: z.string().min(1).max(50).optional(),
  entityType: z.string().min(1).max(100).optional(),
  entityId: z.string().uuid().optional(),
  visibility: fileVisibilitySchema.optional(),
});
export type ListFilesQuery = z.infer<typeof listFilesQuerySchema>;

// ─── Response DTOs ─────────────────────────────────────────────────────────────

/**
 * FileMetadataDto — response an toàn khi trả metadata file.
 *
 * TUYỆT ĐỐI KHÔNG có: storagePath / storageBucket / checksumSha256 / contentHash /
 * storedName / storageProvider / signedUrl / scanResult (chứa chi tiết nội bộ).
 * ownerUserId optional — server mask nếu caller không có quyền xem.
 */
export const fileMetadataSchema = z.object({
  id: z.string().uuid(),
  originalName: z.string(),
  mimeType: z.string(),
  fileExtension: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative(),
  visibility: fileVisibilitySchema,
  uploadStatus: fileUploadStatusSchema,
  scanStatus: fileScanStatusSchema,
  uploadedAt: z.string().datetime(),
  downloadCount: z.number().int().nonnegative(),
  ownerUserId: z.string().uuid().nullable().optional(),
  isTemporary: z.boolean(),
  /** Links hiện tại của file (nếu service eager-load). */
  links: z
    .array(
      z.object({
        id: z.string().uuid(),
        moduleCode: z.string(),
        entityType: z.string(),
        entityId: z.string().uuid(),
        linkType: fileLinkTypeSchema,
        accessScope: fileAccessScopeSchema,
        isPrimary: z.boolean(),
      }),
    )
    .optional(),
});
export type FileMetadataDto = z.infer<typeof fileMetadataSchema>;

/**
 * DownloadUrlDto — signed / proxy URL có TTL ngắn.
 *
 * TUYỆT ĐỐI KHÔNG có: storagePath / storage_path / storageBucket / signedUrl dài hạn.
 * url là proxy URL qua backend hoặc pre-signed URL của S3/MinIO với TTL ngắn.
 * expiresAt PHẢI có — caller dùng để cache đúng TTL.
 */
export const downloadUrlSchema = z.object({
  /** Proxy URL hoặc pre-signed URL với TTL ngắn (< MAX_SIGNED_URL_TTL_SECONDS từ settings). */
  url: z.string().url(),
  /** ISO 8601 datetime — thời điểm URL hết hiệu lực. */
  expiresAt: z.string().datetime(),
});
export type DownloadUrlDto = z.infer<typeof downloadUrlSchema>;

/**
 * FileLinkDto — response khi link file vào entity hoặc list links.
 *
 * TUYỆT ĐỐI KHÔNG lộ storage internals.
 */
export const fileLinkSchema = z.object({
  id: z.string().uuid(),
  fileId: z.string().uuid(),
  moduleCode: z.string(),
  entityType: z.string(),
  entityId: z.string().uuid(),
  linkType: fileLinkTypeSchema,
  accessScope: fileAccessScopeSchema,
  isPrimary: z.boolean(),
  purpose: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type FileLinkDto = z.infer<typeof fileLinkSchema>;

// ─── S2-FND-FILE-2 — Upload E2E (presigned-PUT + confirm) ────────────────────────
//
// Mô hình 2-pha (CHỐT S2-FND-FILE-2, thắng multipart BACKEND-11 §11.4/§11.5):
//   (1) POST /foundation/files/upload  → register metadata (upload_status='Pending') + trả presigned-PUT
//       `uploadUrl` (ephemeral, TTL-ngắn `expiresAt`). KHÔNG stream binary qua NestJS, KHÔNG lộ storage_path.
//   (2) client PUT bytes trực tiếp lên `uploadUrl` (S3/MinIO).
//   (3) POST /foundation/files/:id/confirm → server HEAD/GET verify object tồn tại + size khớp khai báo,
//       tính checksum_sha256 server-side → upload_status='Uploaded'. Sai size/absent → 'Failed'.

/**
 * FOUNDATION-FILE-ERR-* — catalog mã lỗi domain file (SPEC-01 §9 `MODULE-ERR-XXX`). NGUỒN SỰ THẬT DTO
 * (CLAUDE.md §4) — apps/api import LẠI từ đây (KHÔNG khai báo mã cục bộ để tránh drift). APPEND-ONLY:
 * thêm mã mới ở CUỐI, KHÔNG đổi/xoá mã đã có (S2-FND-FILE-2 bổ sung EXTENSION, BLOCKED, CONFIRM-x, NOT-PENDING).
 *
 *  - MIME / SIZE / EXTENSION / BLOCKED / FILENAME / KEY: validate register (415/413/400) TRƯỚC mọi ghi.
 *  - FORBIDDEN / NOT_DOWNLOADABLE / INFECTED / LINK: chốt policy + state-guard (403/409/400).
 *  - DUP_LINK / DUP_PRIMARY: 23505 phân biệt theo TÊN constraint (S2-FND-DB-2-B).
 *  - CONFIRM_ABSENT / CONFIRM_MISMATCH / NOT_PENDING: confirm-upload (422/409).
 */
export const FOUNDATION_FILE_ERROR_CODES = {
  MIME: "FOUNDATION-FILE-ERR-MIME",
  SIZE: "FOUNDATION-FILE-ERR-SIZE",
  EXTENSION: "FOUNDATION-FILE-ERR-EXTENSION",
  BLOCKED: "FOUNDATION-FILE-ERR-BLOCKED",
  FILENAME: "FOUNDATION-FILE-ERR-FILENAME",
  KEY: "FOUNDATION-FILE-ERR-KEY",
  FORBIDDEN: "FOUNDATION-FILE-ERR-FORBIDDEN",
  NOT_DOWNLOADABLE: "FOUNDATION-FILE-ERR-NOT-DOWNLOADABLE",
  INFECTED: "FOUNDATION-FILE-ERR-INFECTED",
  LINK: "FOUNDATION-FILE-ERR-LINK",
  DUP_LINK: "FOUNDATION-FILE-ERR-DUP-LINK",
  DUP_PRIMARY: "FOUNDATION-FILE-ERR-DUP-PRIMARY",
  // ── S2-FND-FILE-2 (append-only) ──
  CONFIRM_ABSENT: "FOUNDATION-FILE-ERR-CONFIRM-ABSENT",
  CONFIRM_MISMATCH: "FOUNDATION-FILE-ERR-CONFIRM-MISMATCH",
  NOT_PENDING: "FOUNDATION-FILE-ERR-NOT-PENDING",
} as const;
export type FoundationFileErrorCode =
  (typeof FOUNDATION_FILE_ERROR_CODES)[keyof typeof FOUNDATION_FILE_ERROR_CODES];

/**
 * RegisterFileResponse — response của POST /foundation/files/upload (register).
 *
 * TUYỆT ĐỐI KHÔNG có: storagePath / storage_path / storageBucket / checksumSha256 (BẤT BIẾN #2.3).
 * `uploadUrl` = presigned-PUT ephemeral TTL-ngắn (KHÔNG persist client-side ngoài phiên upload).
 * `expiresAt` = thời điểm uploadUrl hết hiệu lực (clamp TTL ở adapter — MAX_PRESIGN_TTL_SEC).
 */
export const registerFileResponseSchema = z.object({
  fileId: z.string().uuid(),
  /** Luôn 'Pending' ngay sau register (client PUT rồi confirm mới → 'Uploaded'). */
  uploadStatus: fileUploadStatusSchema,
  /** Presigned-PUT URL (ephemeral) — client PUT bytes trực tiếp lên storage. KHÔNG chứa storage_path thô. */
  uploadUrl: z.string().url(),
  /** ISO 8601 — thời điểm uploadUrl hết hiệu lực. */
  expiresAt: z.string().datetime(),
});
export type RegisterFileResponse = z.infer<typeof registerFileResponseSchema>;

/**
 * ConfirmUploadInput — body của POST /foundation/files/:id/confirm. MỌI field OPTIONAL ⇒ body rỗng `{}`
 * hợp lệ (fileId lấy từ route, size lấy từ row register). `checksumSha256` (nếu client gửi) chỉ để
 * cross-check — server LUÔN tự tính lại checksum từ bytes storage (KHÔNG tin client).
 */
export const confirmUploadInputSchema = z.object({
  checksumSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
});
export type ConfirmUploadInput = z.infer<typeof confirmUploadInputSchema>;

/**
 * ConfirmUploadResponse — response của confirm (thành công). KHÔNG lộ checksumSha256/contentHash/storagePath
 * (BẤT BIẾN #2.3) — chỉ trạng thái + size đã verify. Thất bại (absent/size-mismatch) → lỗi
 * FOUNDATION-FILE-ERR-CONFIRM-* (422/409), KHÔNG trả body này.
 */
export const confirmUploadResponseSchema = z.object({
  fileId: z.string().uuid(),
  /** 'Uploaded' khi confirm thành công. */
  uploadStatus: fileUploadStatusSchema,
  /** Size (bytes) đã verify khớp giữa storage stat và khai báo lúc register. */
  sizeBytes: z.number().int().nonnegative(),
});
export type ConfirmUploadResponse = z.infer<typeof confirmUploadResponseSchema>;
