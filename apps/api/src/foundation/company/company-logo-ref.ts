import { BadRequestException } from "@nestjs/common";
import { BRANDING_ERROR_CODES } from "@mediaos/contracts";

/**
 * Bất biến: con trỏ tệp thương hiệu (logo / favicon) ở đường NGOÀI endpoint branding chỉ nhận
 * rỗng / URL http(s) / giữ nguyên giá trị hiện có. fileId chỉ được đặt qua endpoint branding
 * (đã đi qua lõi gắn tệp). Hàm thuần — không đọc DB.
 */
export type BrandingRefDecision = "write" | "keep" | "reject";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTP_RE = /^https?:\/\//i;

export function classifyBrandingRef(
  current: string | null | undefined,
  next: string,
): BrandingRefDecision {
  const value = next.trim();
  if (value === "") return "write";
  if (UUID_RE.test(value)) {
    return current && current.trim().toLowerCase() === value.toLowerCase() ? "keep" : "reject";
  }
  return HTTP_RE.test(value) ? "write" : "reject";
}

export type ProfileLogoWrite = { write: false } | { write: true; value: string | null };

/** Quyết định ghi `companies.logo_url` ở đường hồ sơ công ty (không phải branding). */
export function resolveProfileLogoWrite(
  current: string | null,
  next: string | null | undefined,
): ProfileLogoWrite {
  if (next === undefined) return { write: false };
  if (next === null) return { write: true, value: null };
  const decision = classifyBrandingRef(current, next);
  if (decision === "keep") return { write: false };
  if (decision === "reject") {
    throw new BadRequestException({
      code: BRANDING_ERROR_CODES.LOGO_REF,
      message: "Logo chỉ nhận URL http(s) hoặc rỗng; tệp logo đặt qua endpoint thương hiệu.",
    });
  }
  return { write: true, value: next };
}
