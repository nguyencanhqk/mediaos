/**
 * S5-ME-BE-1 — hằng số module ME (Personal Hub). Nguồn sự thật CỤC BỘ cho:
 *   - cặp quyền ME.ACCESS (tuple engine — khớp NGUYÊN VĂN mig 0495: action='access', resourceType='me').
 *   - cặp quyền NGUỒN mỗi section (re-check in-process TRƯỚC khi đọc — PermissionGuard chỉ ở controller ⇒
 *     reader gọi thẳng service bypass guard, SPEC-09 §11.2). Mỗi cặp grep-verified KHỚP seed/decorator nguồn.
 *   - module_code nguồn (bật/tắt module — §12.3).
 *
 * KHÔNG dùng chuỗi dotted 'ME.ACCESS' — engine thực thi theo tuple (action, resource_type) (API-11 §5).
 */

import { ME_ERROR_CODES } from "@mediaos/contracts";

/** Cặp quyền cổng ME (mig 0495: ('access','me'), is_sensitive=false). Guard controller dùng cặp NÀY. */
export const ME_ACCESS_PAIR = { action: "access", resourceType: "me", isSensitive: false } as const;

/**
 * Mã lỗi business ME (§12.4) — HTTP status kèm theo. NGUỒN SỰ THẬT DUY NHẤT = packages/contracts
 * ME_ERROR_CODES.DATA_INCONSISTENT (KHÔNG hard-code literal cục bộ — tránh 2 nguồn-sự-thật, mẫu chuẩn
 * FOUNDATION_ERROR_CODES). Re-export tên cục bộ để giữ call-site ngắn.
 */
export const ME_DATA_INCONSISTENT_CODE = ME_ERROR_CODES.DATA_INCONSISTENT;

/**
 * S5-ME-BE-2 — mã lỗi user chưa liên kết employee (409, API-11 §8.4) + timezone-override bị company khoá
 * (422, ME-DEC-008). NGUỒN SỰ THẬT DUY NHẤT = packages/contracts (mirror ME_DATA_INCONSISTENT_CODE).
 */
export const ME_UNLINKED_EMPLOYEE_CODE = ME_ERROR_CODES.UNLINKED_EMPLOYEE;
export const ME_TIMEZONE_OVERRIDE_DENIED_CODE = ME_ERROR_CODES.TIMEZONE_OVERRIDE_DENIED;

/**
 * S5-ME-BE-2 — cặp quyền preferences/avatar (tuple engine — khớp NGUYÊN VĂN mig 0495 (D), Own × 4 role).
 * KHÔNG dùng chuỗi dotted 'ME.PREFERENCE.VIEW_OWN' — engine thực thi theo tuple (API-11 §5).
 */
export const ME_PREFERENCE_VIEW_PAIR = {
  action: "view",
  resourceType: "user-preference",
  isSensitive: false,
} as const;
export const ME_PREFERENCE_UPDATE_PAIR = {
  action: "update",
  resourceType: "user-preference",
  isSensitive: false,
} as const;
export const ME_AVATAR_UPDATE_PAIR = {
  action: "update",
  resourceType: "avatar",
  isSensitive: false,
} as const;

/**
 * S5-ME-BE-2 — module/entity dùng cho `file_links` của avatar (FileOwnerPermissionResolver registry key +
 * FileService.link/unlink input). entityId = `employee_profiles.id` của employee liên kết user hiện tại.
 */
export const ME_MODULE_CODE = "ME";
export const ME_AVATAR_ENTITY_TYPE = "avatar";

/**
 * S5-ME-BE-2 (ME-DEC-008) — setting key company-policy cho phép user override timezone cá nhân. CHƯA seed
 * default ở `foundation/settings/setting-defaults.ts` (ngoài path WO này) — `SettingService.resolveSetting`
 * trả `found=false` khi vắng ⇒ mặc định DENY (khớp "Có NẾU company cho phép", opt-in).
 */
export const ME_TIMEZONE_OVERRIDE_SETTING_KEY = "me.allow_user_timezone_override";

/** Action audit ghi khi phát hiện >1 employee active bất thường (§12.4). object_type='user' (CHECK 0011). */
export const ME_ANOMALY_AUDIT_ACTION = "MeDataInconsistent";

/**
 * 1 section tổng hợp: cặp quyền NGUỒN (re-check) + module_code (bật/tắt) + có phụ thuộc employee không.
 * `sourcePair` khớp NGUYÊN VĂN decorator/seed module nguồn:
 *   HR    → read:employee            (hr-read.controller @RequirePermission("read","employee"), non-sensitive)
 *   ATT   → view-own:attendance      (attendance.controller VIEW_OWN, mig 0454 is_sensitive=TRUE)
 *   LEAVE → view-own:leave-balance   (leave.controller VIEW_OWN_BALANCE, mig 0455 is_sensitive=false)
 *   TASK  → read:task                (tasks.controller getMyTasks, non-sensitive)
 *   NOTI  → read:notification        (my-notifications.controller READ_NOTIFICATION, non-sensitive)
 * `employeeDependent`: HR/ATT/LEAVE cần liên kết employee (§12.2 unlinked → 'unlinked_employee'); TASK/NOTI
 *   theo user_id (vẫn ok khi unlinked).
 */
export interface MeSectionSource {
  readonly key: "hr" | "attendance" | "leave" | "task" | "notification";
  readonly moduleCode: string;
  readonly sourcePair: {
    readonly action: string;
    readonly resourceType: string;
    readonly isSensitive: boolean;
  };
  readonly employeeDependent: boolean;
}

export const ME_SECTION_SOURCES: readonly MeSectionSource[] = [
  {
    key: "hr",
    moduleCode: "HR",
    sourcePair: { action: "read", resourceType: "employee", isSensitive: false },
    employeeDependent: true,
  },
  {
    key: "attendance",
    moduleCode: "ATT",
    sourcePair: { action: "view-own", resourceType: "attendance", isSensitive: true },
    employeeDependent: true,
  },
  {
    key: "leave",
    moduleCode: "LEAVE",
    sourcePair: { action: "view-own", resourceType: "leave-balance", isSensitive: false },
    employeeDependent: true,
  },
  {
    key: "task",
    moduleCode: "TASK",
    sourcePair: { action: "read", resourceType: "task", isSensitive: false },
    employeeDependent: false,
  },
  {
    key: "notification",
    moduleCode: "NOTI",
    sourcePair: { action: "read", resourceType: "notification", isSensitive: false },
    employeeDependent: false,
  },
] as const;

// ─── S5-LMS-BE-3 — GET /me/training (proxy tiến độ đào tạo từ LMS) ───────────────────────────────
//
// Cặp quyền tuple engine `access:lms` — khớp NGUYÊN VĂN mig 0508 (is_sensitive=false, 4 role canonical @ Own).
// TÁI DÙNG cặp của LmsSsoController: "được mở LMS" và "được xem tiến độ học của chính mình" là CÙNG một
// quyền nghiệp vụ ⇒ KHÔNG seed permission mới (admin thu hồi 1 chỗ là tắt cả hai — §13).

export const ME_TRAINING_ACCESS_PAIR = {
  action: "access",
  resourceType: "lms",
  isSensitive: false,
} as const;

/**
 * Mã lỗi tiến độ đào tạo — NGUỒN SỰ THẬT DUY NHẤT = packages/contracts (mirror ME_UNLINKED_EMPLOYEE_CODE).
 * 503 disabled (cấu hình) · 502 unavailable (LMS chết/timeout) · 502 contract-mismatch (payload lệch v1).
 */
export const ME_TRAINING_LMS_DISABLED_CODE = ME_ERROR_CODES.TRAINING_LMS_DISABLED;
export const ME_TRAINING_LMS_UNAVAILABLE_CODE = ME_ERROR_CODES.TRAINING_LMS_UNAVAILABLE;
export const ME_TRAINING_CONTRACT_MISMATCH_CODE = ME_ERROR_CODES.TRAINING_CONTRACT_MISMATCH;

/** TTL cache tiến độ (giây). Đủ ngắn để dữ liệu không cũ, đủ dài để không đụng trần 120 req/phút/IP của LMS. */
export const ME_TRAINING_CACHE_TTL_SEC = 60;

/**
 * Cache key tiến độ đào tạo — BẮT BUỘC gồm CẢ companyId VÀ userId (BẤT BIẾN #1): khoá theo email/IP/phiên
 * sẽ cho 2 actor đọc trúng entry của nhau. KHÔNG bao giờ đưa email vào key (email là PII, key nằm trong
 * Valkey dùng chung + hiện trong log lỗi của ValkeyService).
 */
export function meTrainingCacheKey(companyId: string, userId: string): string {
  return `me:training:${companyId}:${userId}`;
}

/** Setting key bật/tắt module (mirror module-catalog.service settingKey). */
export function moduleEnabledKey(moduleCode: string): string {
  return `module.${moduleCode}.enabled`;
}
