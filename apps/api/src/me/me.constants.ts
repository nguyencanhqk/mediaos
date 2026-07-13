/**
 * S5-ME-BE-1 — hằng số module ME (Personal Hub). Nguồn sự thật CỤC BỘ cho:
 *   - cặp quyền ME.ACCESS (tuple engine — khớp NGUYÊN VĂN mig 0495: action='access', resourceType='me').
 *   - cặp quyền NGUỒN mỗi section (re-check in-process TRƯỚC khi đọc — PermissionGuard chỉ ở controller ⇒
 *     reader gọi thẳng service bypass guard, SPEC-09 §11.2). Mỗi cặp grep-verified KHỚP seed/decorator nguồn.
 *   - module_code nguồn (bật/tắt module — §12.3).
 *
 * KHÔNG dùng chuỗi dotted 'ME.ACCESS' — engine thực thi theo tuple (action, resource_type) (API-11 §5).
 */

/** Cặp quyền cổng ME (mig 0495: ('access','me'), is_sensitive=false). Guard controller dùng cặp NÀY. */
export const ME_ACCESS_PAIR = { action: "access", resourceType: "me", isSensitive: false } as const;

/** Mã lỗi business ME (§12.4) — HTTP status kèm theo. Đăng ký ở packages/contracts ME_ERROR_CODES. */
export const ME_DATA_INCONSISTENT_CODE = "ME-ERR-DATA-INCONSISTENT";

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

/** Setting key bật/tắt module (mirror module-catalog.service settingKey). */
export function moduleEnabledKey(moduleCode: string): string {
  return `module.${moduleCode}.enabled`;
}
