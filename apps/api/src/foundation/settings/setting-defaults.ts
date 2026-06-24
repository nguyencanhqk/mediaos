import type { SettingValueType } from "./settings.dto";

/**
 * S1-FND-SETTING-1 — TẦNG CUỐI của precedence (BACKEND-11 §13.3): company_settings → system_settings →
 * DEFAULT HARD-CODED. Đây là fallback cuối khi cả company + system đều thiếu key. KISS: chỉ key MVP cần
 * (đồng bộ giá trị với seed system_settings mig 0435 §5b để FE không lệch khi seed vắng).
 *
 * MASK an toàn (BẤT BIẾN #3): KHÔNG đặt secret/SecretRef ở đây — defaults chỉ chứa cấu hình công khai.
 */
export interface SettingDefault {
  value: unknown;
  valueType: SettingValueType;
  category: string;
  moduleCode: string | null;
  isPublic: boolean;
}

/** key → default. isPublic=true ⇒ lọt /public khi cả 2 bảng vắng (nhưng KHÔNG có secret_ref ở tầng này). */
export const SETTING_DEFAULTS: Readonly<Record<string, SettingDefault>> = Object.freeze({
  "system.default_timezone": {
    value: "Asia/Ho_Chi_Minh",
    valueType: "String",
    category: "General",
    moduleCode: "SYSTEM",
    isPublic: true,
  },
  "system.default_locale": {
    value: "vi",
    valueType: "String",
    category: "General",
    moduleCode: "SYSTEM",
    isPublic: true,
  },
  "file.max_upload_size_mb": {
    value: 25,
    valueType: "Number",
    category: "File",
    moduleCode: "SYSTEM",
    isPublic: true,
  },
  "file.allowed_mime_types": {
    value: [
      "image/png",
      "image/jpeg",
      "image/webp",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
      "text/plain",
    ],
    valueType: "Array",
    category: "File",
    moduleCode: "SYSTEM",
    isPublic: true,
  },
  "audit.default_retention_days": {
    value: 365,
    valueType: "Number",
    category: "Audit",
    moduleCode: "SYSTEM",
    isPublic: true,
  },
});

/** Default cho 1 key (undefined nếu không có default — caller xử lý "không tìm thấy"). */
export function getSettingDefault(key: string): SettingDefault | undefined {
  return Object.prototype.hasOwnProperty.call(SETTING_DEFAULTS, key)
    ? SETTING_DEFAULTS[key]
    : undefined;
}
