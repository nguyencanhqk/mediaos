import type { BrandingKind } from "@mediaos/contracts";

/**
 * S5-BRAND-BE-1 — hằng số thương hiệu công ty (logo + favicon). Nguồn sự thật CỤC BỘ cho: cặp quyền
 * (tuple engine), whitelist MIME + trần size theo `kind`, key setting favicon, module/entity của file_links.
 */

/**
 * Cặp quyền TÁI DÙNG của foundation-company (seed mig 0435, grant company-admin qua resource_type LIKE
 * 'foundation-%') — WO này KHÔNG thêm quyền mới. READ = view, mọi MUTATION = update.
 */
/**
 * CỐ Ý KHÔNG CÒN cặp `view:foundation-company` ở đây (security-review vòng 2, LOW — dead code).
 *
 * Đường ĐỌC branding là authenticated-only: `CompanyBrandingController.getBranding` không gate, và
 * `CompanyBrandingFileResolver.canRead` chỉ kiểm `entityId === companyId`. Giữ lại hằng `BRANDING_VIEW_PAIR`
 * mà 0 consumer là mời người sau nối nhầm nó vào đường đọc, làm tính năng chết với mọi nhân viên
 * không phải company-admin. Cần cặp view cho việc khác thì khai tại chỗ dùng.
 */
export const BRANDING_UPDATE_PAIR = {
  action: "update",
  resourceType: "foundation-company",
} as const;

/**
 * `file_links` của tài sản thương hiệu — entityId = companies.id.
 *
 * TÁCH logo vs favicon bằng `entityType` (chuỗi TỰ DO, max 100 — files.ts) chứ KHÔNG bằng `linkType`:
 * `linkType` là ENUM đóng (Avatar|Attachment|Contract|Proof|Document|Import|Export|Other) ép ở cả Zod lẫn
 * CHECK trong DB ⇒ thêm 'CompanyLogo' đòi MIGRATION, mà WO này chốt KHÔNG migration. Cả hai kind dùng
 * linkType='Other'; truy vấn link vốn đã theo (moduleCode, entityType, entityId) nên tách bằng entityType
 * là đường tự nhiên, không cần lọc thêm.
 */
export const BRANDING_MODULE_CODE = "FOUNDATION";
export const BRANDING_LINK_TYPE = "Other" as const;

/** `company_settings` key lưu fileId favicon (KHÔNG migration — SettingService upsert sẵn). */
export const FAVICON_SETTING_KEY = "branding.favicon_file_id";

const KB = 1024;
const MB = 1024 * KB;

/**
 * Ràng buộc theo `kind`. Cố ý HẸP HƠN allowlist file chung (`file.allowed_mime_types`) — branding là ảnh,
 * không phải tài liệu.
 *
 * KHÔNG có `image/svg+xml` dù done_when nêu: SVG là XML CÓ THỂ NHÚNG `<script>`; phục vụ lại từ origin
 * của mình = stored-XSS. Cho phép SVG đòi sanitize server-side (DOMPurify/svg-hush) — ngoài phạm vi WO
 * "không migration, không quyền mới" này. png/webp/jpeg phủ đủ nhu cầu logo; ico/png phủ favicon.
 *
 * `maxBytes` là HẰNG SỐ (không magic number rải rác). FileService còn re-validate trần chung
 * `file.max_upload_size_mb` — hai tầng, tầng hẹp hơn thắng.
 */
export interface BrandingKindRule {
  readonly allowedMimeTypes: readonly string[];
  readonly maxBytes: number;
  /** `entityType` trên `file_links` — tách link logo vs favicon trên cùng entityId (companies.id). */
  readonly entityType: string;
}

export const BRANDING_RULES: Readonly<Record<BrandingKind, BrandingKindRule>> = Object.freeze({
  logo: {
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    maxBytes: 2 * MB,
    entityType: "company-logo",
  },
  favicon: {
    // KHÔNG có image/x-icon (.ico) — xem ghi chú dưới. png/webp phủ đủ favicon trên mọi trình duyệt hiện đại.
    allowedMimeTypes: ["image/png", "image/webp"],
    maxBytes: 512 * KB,
    entityType: "company-favicon",
  },
});

/**
 * NỢ GHI NHẬN (security-review #2) — favicon `.ico` CHƯA hỗ trợ được, và KHÔNG thể vá bằng
 * `setting-defaults.ts`: `SettingService.resolveMany` chạy precedence company > system > **default**, mà
 * `file.allowed_mime_types` CÓ hàng Active trong `system_settings` (seed mig 0435, mig 0470 assert giữ)
 * ⇒ tầng `default` KHÔNG BAO GIỜ được đọc. Thêm MIME vào defaults là code CHẾT trên mọi DB đã migrate
 * (đã verify trên DB thật: hàng system chỉ có png/jpeg/webp/pdf/docx/xlsx/csv/txt).
 *
 * Muốn bật `.ico` phải có MIGRATION union-add 2 MIME vào hàng `system_settings` (jsonb array, idempotent,
 * KHÔNG rewrite từ snapshot cũ) + thêm map `ico` vào MIME_TO_EXTENSIONS. WO này chốt KHÔNG migration nên
 * để lại cho WO sau; whitelist ở trên khớp ĐÚNG thực tế thay vì hứa suông rồi 415 ở runtime.
 */

/** Mọi entityType branding — dùng cho đăng ký resolver (khớp NGUYÊN VĂN entityType ở BRANDING_RULES). */
export function brandingEntityTypes(): readonly string[] {
  return Object.values(BRANDING_RULES).map((r) => r.entityType);
}

/** True nếu `value` trông như UUID v4-ish ⇒ diễn giải là fileId; ngược lại là URL ngoài (dữ liệu cũ). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function looksLikeFileId(value: string): boolean {
  return UUID_RE.test(value.trim());
}
