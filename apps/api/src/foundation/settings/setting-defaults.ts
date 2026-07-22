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
  // S2-FND-FILE-2 — blocklist phần mở rộng nguy hiểm (executable/script/markup có thể chứa payload). Đối
  // chiếu Ở TẦNG SERVICE lúc register (FileService.upload): extension ĐÃ sanitize ∈ blocked → reject
  // FOUNDATION-FILE-ERR-BLOCKED (KHÔNG tạo row/không audit). Bổ trợ MIME-allowlist (file.allowed_mime_types)
  // + đối chiếu extension↔MIME chống spoof. Company có thể override qua company_settings (precedence
  // company>system>default — S1-FND-SETTING-1). isPublic=true (cấu hình vận hành, KHÔNG secret — BẤT BIẾN #3).
  "file.blocked_extensions": {
    value: [
      "exe",
      "bat",
      "cmd",
      "com",
      "sh",
      "bash",
      "js",
      "jse",
      "mjs",
      "vbs",
      "vbe",
      "ps1",
      "psm1",
      "msi",
      "scr",
      "pif",
      "jar",
      "dll",
      "so",
      "app",
      "deb",
      "rpm",
      "html",
      "htm",
      "xhtml",
      "shtml",
      "svg",
      "php",
      "phtml",
      "asp",
      "aspx",
      "jsp",
      "py",
      "pl",
      "rb",
      "cgi",
    ],
    valueType: "Array",
    category: "File",
    moduleCode: "SYSTEM",
    isPublic: true,
  },
  // S2-FND-JOBS-1 (jobs_tempfile) — TTL (giờ) cho file upload_status='Pending' bị treo (client bỏ dở confirm).
  // TEMP_FILE_CLEANUP soft-delete file Pending có created_at cũ hơn ngưỡng này (precedence company>system>
  // default — S1-FND-SETTING-1). Number/isPublic=true (cấu hình vận hành, KHÔNG secret — BẤT BIẾN #3).
  "file.pending_ttl_hours": {
    value: 24,
    valueType: "Number",
    category: "File",
    moduleCode: "SYSTEM",
    isPublic: true,
  },
  // S2-HR-BE-6 scope FIX (2026-07-02, owner-chốt session 1849d064): ngưỡng cảnh báo hợp đồng sắp hết hạn
  // là company-configurable qua company_settings (PATCH /settings/company/:key, S1-FND-SETTING-1) — CHƯA
  // có UI cấu hình riêng (follow-up nếu cần). 2 mốc mặc định [30,7] ngày (DB-03 §7.7 quy tắc 5): milestone
  // rộng nhất (30) quyết định EmployeeContractDto.expiringSoon (giữ nguyên hợp đồng DTO boolean hiện có);
  // cả 2 mốc lộ qua GET /hr/contracts/expiry-thresholds cho FE hiển thị nhiều cấp cảnh báo.
  "hr.contract_expiring_warning_days": {
    value: [30, 7],
    valueType: "Array",
    category: "HR",
    moduleCode: "HR",
    isPublic: true,
  },

  // ─── S2-FND-SEED-4 — 11 COMPANY-DEFAULT key (DB-10 §11.2) ở TẦNG FALLBACK ───────────────────────
  // Precedence company_settings → system_settings → DEFAULT (đây). KHÔNG seed per-company (bài học
  // 0445:14-18 — per-company seed = drift), KHÔNG migration company-scoped: chỉ mở rộng fallback hard-coded.
  // value/valueType/moduleCode theo DB-10 §11.2. isPublic=true = cấu hình vận hành an toàn (KHÔNG secret) để
  // FE bootstrap (timezone/locale/currency/shift/checkin/leave/task/dashboard). TUYỆT ĐỐI KHÔNG SecretRef
  // (BẤT BIẾN #3). resolveMany/resolveSetting trả scope='default' cho các key này khi cả 2 bảng vắng.
  //
  // LƯU Ý — notification.in_app_enabled (§11.2) CỐ Ý KHÔNG có entry ở đây: system_settings LUÔN seed key này
  // (mig 0470, is_public=true) ⇒ tầng system THẮNG trong resolveMany trước khi chạm default. Một entry default
  // cho notification.in_app_enabled sẽ là fallback KHÔNG BAO GIỜ reachable (system luôn phủ) → bỏ để tránh
  // nguồn drift thứ 4. resolveSetting('notification.in_app_enabled') → scope='system' value=true (owner-note 1).
  "company.timezone": {
    value: "Asia/Ho_Chi_Minh",
    valueType: "String",
    category: "General",
    moduleCode: "SYSTEM",
    isPublic: true,
  },
  "company.locale": {
    value: "vi-VN",
    valueType: "String",
    category: "General",
    moduleCode: "SYSTEM",
    isPublic: true,
  },
  "company.currency": {
    value: "VND",
    valueType: "String",
    category: "General",
    moduleCode: "SYSTEM",
    isPublic: true,
  },
  "attendance.default_shift_code": {
    value: "OFFICE_8H",
    valueType: "String",
    category: "Attendance",
    moduleCode: "ATT",
    isPublic: true,
  },
  "attendance.allow_web_checkin": {
    value: true,
    valueType: "Boolean",
    category: "Attendance",
    moduleCode: "ATT",
    isPublic: true,
  },
  "attendance.allow_mobile_checkin": {
    value: true,
    valueType: "Boolean",
    category: "Attendance",
    moduleCode: "ATT",
    isPublic: true,
  },
  "attendance.block_checkin_when_leave_approved": {
    value: true,
    valueType: "Boolean",
    category: "Attendance",
    moduleCode: "ATT",
    isPublic: true,
  },
  "leave.allow_negative_balance": {
    value: false,
    valueType: "Boolean",
    category: "Leave",
    moduleCode: "LEAVE",
    isPublic: true,
  },
  "leave.default_annual_leave_days": {
    value: 12,
    valueType: "Number",
    category: "Leave",
    moduleCode: "LEAVE",
    isPublic: true,
  },
  "task.allow_personal_task": {
    value: true,
    valueType: "Boolean",
    category: "Task",
    moduleCode: "TASK",
    isPublic: true,
  },
  "dashboard.cache_enabled": {
    value: true,
    valueType: "Boolean",
    category: "Dashboard",
    moduleCode: "DASH",
    isPublic: true,
  },
});

/** Default cho 1 key (undefined nếu không có default — caller xử lý "không tìm thấy"). */
export function getSettingDefault(key: string): SettingDefault | undefined {
  return Object.prototype.hasOwnProperty.call(SETTING_DEFAULTS, key)
    ? SETTING_DEFAULTS[key]
    : undefined;
}
