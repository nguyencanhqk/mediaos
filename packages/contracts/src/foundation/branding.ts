import { z } from "zod";

/**
 * S5-BRAND-BE-1 — Thương hiệu công ty (logo + favicon) cho /api/v1/foundation/company/branding.
 *
 * LƯU TRỮ (quyết định seed-time — KHÔNG migration, KHÔNG quyền mới):
 *   - logo    → cột `companies.logo_url` SẴN CÓ, chứa **fileId (UUID)** tham chiếu `files`.
 *   - favicon → `company_settings` key `branding.favicon_file_id` qua SettingService.
 *   - Bảng `tenant_branding` (mig 0300, di sản AC-4 ngoài docs/DB) KHÔNG nối lại — xem ui-config.ts.
 *
 * `companies.logo_url` là text TỰ DO nên có thể chứa 2 dạng (tương thích ngược):
 *   (a) fileId UUID  → server ký presigned-URL TTL-ngắn khi trả `GET /branding` (`kind='file'`).
 *   (b) http(s) URL  → giá trị cũ nhập tay ở console /settings/company, trả nguyên văn (`kind='external'`).
 * Vì vậy `logoUrl` ở companyViewSchema/companySettingsSchema KHÔNG được ép `.url()` — xem ghi chú ở đó.
 *
 * BẤT BIẾN #3: KHÔNG lộ storage_path/bucket/checksum — chỉ fileId + URL ephemeral (mirror files.ts).
 */

/** Loại tài sản thương hiệu. Dùng làm path-param `:kind` (logo|favicon). */
export const brandingKindSchema = z.enum(["logo", "favicon"]);
export type BrandingKind = z.infer<typeof brandingKindSchema>;

/**
 * 1 tài sản thương hiệu đã phân giải để hiển thị.
 *   - `source='file'`     → `fileId` UUID, `url` presigned TTL-ngắn, `expiresAt` thời điểm hết hạn.
 *   - `source='external'` → `fileId=null`, `url` là URL nhập tay cũ, `expiresAt=null` (không hết hạn).
 * `url` CỐ Ý KHÔNG `.url()`: presigned-URL của MinIO/R2 luôn hợp lệ, nhưng giá trị `external` là dữ liệu
 * LỊCH SỬ do người nhập — ép .url() ở response = biến dữ liệu bẩn thành ZodError runtime ở FE (HTTP 200
 * nhưng apiFetch ném) thay vì hiển thị được. Validate chặt ở ĐƯỜNG GHI, khoan dung ở đường đọc.
 */
export const brandingAssetSchema = z.object({
  source: z.enum(["file", "external"]),
  fileId: z.string().uuid().nullable(),
  url: z.string().min(1),
  expiresAt: z.string().datetime().nullable(),
});
export type BrandingAsset = z.infer<typeof brandingAssetSchema>;

/**
 * Response `GET /api/v1/foundation/company/branding` (gate view:foundation-company).
 * Mỗi mục `null` = chưa đặt HOẶC không hiển-thị-được (FAIL-SOFT: file bị gỡ/Infected/presign lỗi → null,
 * KHÔNG 500 — read tải-trang không được vỡ, mirror GET /me/avatar SPEC-09 §12.2).
 */
export const companyBrandingSchema = z.object({
  logo: brandingAssetSchema.nullable(),
  favicon: brandingAssetSchema.nullable(),
});
export type CompanyBranding = z.infer<typeof companyBrandingSchema>;

/**
 * Body `POST /foundation/company/branding/:kind/upload-url` — đăng ký file ẢNH Private để chuẩn bị đặt
 * làm logo/favicon. Mirror meAvatarUploadUrlInputSchema (S5-ME-BE-4): `originalName` PHẢI mang đuôi ảnh
 * hợp lệ (đối chiếu extension↔MIME chống spoof), server re-validate allowlist + size ở register và
 * re-check checksum/size ở confirm — KHÔNG tin mù client.
 */
export const brandingUploadUrlInputSchema = z.object({
  originalName: z.string().trim().min(1).max(500),
  declaredMimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().nonnegative(),
});
export type BrandingUploadUrlInput = z.infer<typeof brandingUploadUrlInputSchema>;

/** Response upload-url — presigned-PUT ephemeral TTL-ngắn. KHÔNG lộ storage_path (BẤT BIẾN #3). */
export const brandingUploadUrlResponseSchema = z.object({
  fileId: z.string().uuid(),
  uploadUrl: z.string().url(),
  expiresAt: z.string().datetime(),
});
export type BrandingUploadUrlResponse = z.infer<typeof brandingUploadUrlResponseSchema>;

/** Body `POST /:kind/confirm` và `PUT /:kind` — fileId của file đã (hoặc sắp) upload xong. */
export const setBrandingInputSchema = z.object({
  fileId: z.string().uuid(),
});
export type SetBrandingInput = z.infer<typeof setBrandingInputSchema>;

/**
 * Mã lỗi nghiệp vụ riêng của branding. MIME/size dùng lại FOUNDATION_FILE_ERROR_CODES (files.ts) để FE
 * chỉ phải map MỘT bộ mã cho mọi đường upload.
 */
export const BRANDING_ERROR_CODES = {
  /** `:kind` ngoài logo|favicon (phòng thủ — Zod path-param đã chặn trước). */
  UNKNOWN_KIND: "FOUNDATION-BRAND-ERR-UNKNOWN-KIND",
} as const;
