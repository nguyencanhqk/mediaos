import { z } from "zod";
import {
  brandingAssetSchema,
  brandingUploadUrlResponseSchema,
  companyBrandingSchema,
  confirmUploadResponseSchema,
  type BrandingAsset,
  type BrandingKind,
  type CompanyBranding,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { DEFAULT_UPLOAD_MIME, putBytesToStorage } from "./storage-upload";

/**
 * S5-BRAND-FE-1 — client cho /api/v1/foundation/company/branding (logo + favicon).
 *
 * Gate: GET ⇐ view:foundation-company · mọi mutation ⇐ update:foundation-company (KHÔNG quyền mới).
 * Client CHỈ pre-check MIME/size cho UX — server re-validate và là chốt cuối (415/413/403).
 *
 * `url` trong BrandingAsset là EPHEMERAL (presigned TTL ngắn) khi `source==='file'`; đừng cache dài, đừng
 * persist. `source==='external'` là URL nhập tay cũ (không hết hạn) — giữ để tương thích ngược.
 */

const BASE = "/foundation/company/branding";

/**
 * Allowlist client PHẢI là TẬP CON của whitelist server (`BRANDING_RULES` ở apps/api) — lệch sẽ thành
 * "chọn được rồi mới 415". Đặc biệt: KHÔNG có `image/svg+xml` (server chặn để tránh stored-XSS) và
 * KHÔNG có `image/x-icon` (allowlist MIME toàn cục trong system_settings chưa có .ico — cần migration).
 */
export const BRANDING_ACCEPTED_MIME: Readonly<Record<BrandingKind, readonly string[]>> = {
  logo: ["image/png", "image/jpeg", "image/webp"],
  favicon: ["image/png", "image/webp"],
};

/** Trần size theo kind — khớp `BRANDING_RULES[kind].maxBytes` của server. */
export const BRANDING_MAX_BYTES: Readonly<Record<BrandingKind, number>> = {
  logo: 2 * 1024 * 1024,
  favicon: 512 * 1024,
};

/** Giá trị cho thuộc tính `accept` của <input type="file"> theo kind. */
export function brandingAcceptAttr(kind: BrandingKind): string {
  return BRANDING_ACCEPTED_MIME[kind].join(",");
}

export type BrandingValidationError = "type" | "size";

/** Pre-check phía client (server vẫn là chốt). null = hợp lệ. */
export function validateBrandingFile(
  kind: BrandingKind,
  file: File,
): BrandingValidationError | null {
  if (!BRANDING_ACCEPTED_MIME[kind].includes(file.type)) return "type";
  if (file.size > BRANDING_MAX_BYTES[kind]) return "size";
  return null;
}

export const brandingApi = {
  /**
   * GET /foundation/company/branding — `{logo, favicon}`, mỗi mục null khi chưa đặt HOẶC không hiển-thị-được
   * (server fail-soft: con trỏ treo/file bị gỡ/presign lỗi → null, KHÔNG 500).
   */
  getBranding: (): Promise<CompanyBranding> => apiFetch(BASE, companyBrandingSchema),

  /**
   * Upload + đặt tài sản thương hiệu — 4 pha, bất kỳ pha nào lỗi → ném NGAY (KHÔNG âm thầm bỏ pha sau):
   *   (1) POST /:kind/upload-url — đăng ký file Private + presigned-PUT.
   *   (2) PUT bytes thẳng lên storage (Content-Type khớp declaredMimeType — lệch ⇒ 403 SignatureDoesNotMatch).
   *   (3) POST /:kind/confirm — server verify size/checksum, flip Pending→Uploaded.
   *   (4) PUT /:kind — gắn làm logo/favicon (thay cái cũ) → trả asset kèm URL TƯƠI để hiển thị ngay.
   */
  uploadAsset: async (kind: BrandingKind, file: File): Promise<BrandingAsset> => {
    const declaredMimeType = file.type || DEFAULT_UPLOAD_MIME;
    const reg = await apiFetch(`${BASE}/${kind}/upload-url`, brandingUploadUrlResponseSchema, {
      method: "POST",
      body: JSON.stringify({ originalName: file.name, declaredMimeType, sizeBytes: file.size }),
    });
    await putBytesToStorage(reg.uploadUrl, file, declaredMimeType);
    await apiFetch(`${BASE}/${kind}/confirm`, confirmUploadResponseSchema, {
      method: "POST",
      body: JSON.stringify({ fileId: reg.fileId }),
    });
    return apiFetch(`${BASE}/${kind}`, brandingAssetSchema, {
      method: "PUT",
      body: JSON.stringify({ fileId: reg.fileId }),
    });
  },

  /** DELETE /:kind — gỡ logo/favicon hiện có. Idempotent (chưa đặt vẫn 204). */
  removeAsset: (kind: BrandingKind): Promise<void> =>
    apiFetch(`${BASE}/${kind}`, z.undefined(), { method: "DELETE" }).then(() => undefined),
};
