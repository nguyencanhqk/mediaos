/**
 * S5-GOAL-FE-1 — hằng số module Mục tiêu (SPEC-10). Cặp quyền + đường dẫn + tập enum cho select.
 *
 * GOAL_ENGINE_PAIRS = cặp engine THẬT seed mig 0506 (KHÔNG mã FE MODULE.RESOURCE.ACTION qua
 * PERMISSION_CODE_TO_PAIR — tránh drift, cùng kỹ thuật LEAVE_ENGINE_PAIRS/HR_ENGINE_PAIRS). Các cặp
 * goal là is_sensitive=false ⇒ có trong /auth/me capabilities ⇒ dùng `useCan` (KHÔNG cần useCanExact).
 */

export const GOAL_ENGINE_PAIRS = {
  /** Cổng nav menu Mục tiêu. */
  ACCESS: { action: "access", resourceType: "goal" },
  /** Xem mục tiêu (GET /goals, /goals/tree, /goals/:id). */
  VIEW: { action: "view", resourceType: "goal" },
  /** Tạo mục tiêu (POST /goals). */
  CREATE: { action: "create", resourceType: "goal" },
  /** Sửa mục tiêu (PATCH /goals/:id). */
  UPDATE: { action: "update", resourceType: "goal" },
  /** Xóa mềm (DELETE /goals/:id). */
  DELETE: { action: "delete", resourceType: "goal" },
  /** Check-in tiến độ (FE-2). */
  CHECKIN: { action: "checkin", resourceType: "goal" },
  /** Chốt kỳ / mở lại (FE-2). */
  FINALIZE: { action: "finalize", resourceType: "goal" },
} as const;

/**
 * Cấp mục tiêu cho FORM tạo/sửa — CỐ Ý loại `company` (GOAL-ERR-004: MVP service chặn cấp công ty;
 * CHECK vẫn cho phép để phase sau bật). 3 cấp: phòng ban → dự án → nhân viên.
 */
export const GOAL_LEVEL_OPTIONS = ["department", "project", "employee"] as const;
export type GoalLevelOption = (typeof GOAL_LEVEL_OPTIONS)[number];

/** 4 mode đo ĐỘC QUYỀN (SPEC-10 §13.1). `project` chỉ hợp lệ với goal cấp `project` (GOAL-ERR-012). */
export const GOAL_PROGRESS_MODE_OPTIONS = ["manual", "project", "tasks", "children"] as const;

export const GOAL_STATUS_OPTIONS = ["Draft", "Active", "Completed", "Cancelled"] as const;

export const GOAL_PERIOD_TYPE_OPTIONS = ["quarter", "year", "custom"] as const;

export const GOAL_MEASURE_TYPE_OPTIONS = ["percent", "number", "boolean"] as const;

// ─── S5-GOAL-FE-2 (APPEND) — vòng đo ──────────────────────────────────────────────────────────────

/** Khoảng `confidence` của check-in — PIN theo `checkinGoalSchema` + DB CHECK (DB-11 §6.2). */
export const CHECKIN_CONFIDENCE_MIN = 0;
export const CHECKIN_CONFIDENCE_MAX = 100;

/** Trần % tiến độ nhập tay (measureType='percent'). */
export const PROGRESS_PERCENT_MAX = 100;

/** Số dòng mỗi trang của sổ check-in (GET /goals/:id/updates). Server KHÔNG trả `total` ⇒ pager
 * prev/next thuần: còn đủ `limit` dòng thì CÓ THỂ còn trang sau. */
export const GOAL_UPDATES_PAGE_SIZE = 20;

/** Số mục tiêu hiển thị trong card "Mục tiêu của tôi" ở Tổng quan ME (xem đủ ở /goals). */
export const ME_GOALS_PREVIEW_LIMIT = 3;

/**
 * Cặp quyền TASK mà FE cần cho đường gắn/tháo việc ↔ mục tiêu. CỔNG THỨ HAI (ngoài `update:goal`) do
 * `goal-tasks-link.service.ts` ép — gắn task vào mục tiêu là GHI vào hàng `tasks`, nên phải có phạm vi
 * ghi của cặp `('update','task')`. Dựng thiếu cổng này ⇒ hiện nút rồi ăn 403 (hoặc tệ hơn: tưởng
 * mình sửa được task ngoài phạm vi qua đường vòng mục tiêu).
 */
export const TASK_UPDATE_PAIR_FOR_GOAL_LINK = { action: "update", resourceType: "task" } as const;

// ─── S5-GOAL-TPL-1 (APPEND) — Đợt D: danh mục template + phân rã ───────────────────────────────────

/**
 * Cặp quyền danh mục việc mẫu (GOAL-SCREEN-006) — seed mig 0527, is_sensitive=false (⇒ `useCan` đủ).
 * `resourceType` là `task-template` GẠCH-NỐI (khớp bảng `permissions`); `task_template` GẠCH-DƯỚI là
 * audit object_type ở BE — KHÔNG lẫn hai cái.
 */
export const TASK_TEMPLATE_MANAGE_PAIR = {
  action: "manage",
  resourceType: "task-template",
} as const;

/**
 * CỔNG THỨ HAI của phân rã (ngoài `update:goal`): phân rã TẠO TASK nên phải có `('create','task')`
 * (+ `('update-state','task')` nếu chọn cột board). BE ép qua `TaskCoreService.resolveCreateGate` —
 * FE chỉ ẩn/disable trước cho đỡ bấm-rồi-403.
 */
export const TASK_CREATE_PAIR_FOR_DECOMPOSE = { action: "create", resourceType: "task" } as const;
export const TASK_UPDATE_STATE_PAIR = { action: "update-state", resourceType: "task" } as const;

/**
 * Ưu tiên của việc mẫu — LOWERCASE theo CHECK mig 0526 (KHÁC `Low|Medium|High|Urgent` của bảng `tasks`;
 * BE map một chiều khi áp template). `none` = không đặt ưu tiên.
 */
export const TASK_TEMPLATE_PRIORITY_OPTIONS = ["urgent", "high", "medium", "low", "none"] as const;
