/**
 * S11-ASSET-FE-1 — hằng số module Tài sản (SPEC-13). Cặp quyền + tập enum cho select + màu badge.
 *
 * ASSET_ENGINE_PAIRS = cặp engine THẬT đọc từ CONTROLLER (assets/asset-categories/asset-inventories/
 * me-assets .controller.ts, seed mig 0550) — KHÔNG mã FE `MODULE.RESOURCE.ACTION` qua
 * PERMISSION_CODE_TO_PAIR, cùng kỹ thuật GOAL_ENGINE_PAIRS/LEAVE_ENGINE_PAIRS để tránh pair-drift.
 * Cả 11 cặp `is_sensitive = false` (SPEC-13 §11 chốt cùng seed) ⇒ có trong `/auth/me` capabilities
 * ⇒ dùng `useCan` (KHÔNG cần `useCanExact` — cặp nhạy cảm mới bị lọc khỏi capabilities).
 */

export const ASSET_ENGINE_PAIRS = {
  /** Cổng nav menu Tài sản — KHÔNG route nào enforce, chỉ gate hiển thị (họ access:goal/access:me). */
  ACCESS: { action: "access", resourceType: "asset" },
  /** Đọc loại · tài sản · lịch sử cấp phát/bảo trì · đợt kiểm kê · thống kê · /me/assets. */
  VIEW: { action: "view", resourceType: "asset" },
  CREATE: { action: "create", resourceType: "asset" },
  UPDATE: { action: "update", resourceType: "asset" },
  DELETE: { action: "delete", resourceType: "asset" },
  ASSIGN: { action: "assign", resourceType: "asset" },
  REVOKE: { action: "revoke", resourceType: "asset" },
  /** Thanh lý · ghi nhận mất · tìm thấy lại — MỘT cặp cho cả ba (SPEC-13 §11). */
  DISPOSE: { action: "dispose", resourceType: "asset" },
  MANAGE_CATEGORY: { action: "manage", resourceType: "asset-category" },
  MANAGE_MAINTENANCE: { action: "manage", resourceType: "asset-maintenance" },
  MANAGE_INVENTORY: { action: "manage", resourceType: "asset-inventory" },
} as const;

/** 5 trạng thái vòng đời (SPEC-13 §13.1 FSM) — khớp `assetLifecycleStatusSchema` của contracts. */
export const ASSET_STATUS_OPTIONS = [
  "In Stock",
  "Assigned",
  "Under Maintenance",
  "Disposed",
  "Lost",
] as const;
export type AssetStatusOption = (typeof ASSET_STATUS_OPTIONS)[number];

export const ASSET_ISSUE_CONDITION_OPTIONS = ["Good", "Damaged"] as const;

/**
 * Tình trạng lúc thu hồi — 3 giá trị, ép ở CHECK cấp DB (ASSET-ERR-016), KHÔNG chỉ Zod. `Lost` đưa tài
 * sản sang trạng thái `Lost` thay vì về kho (SPEC-13 §13.2) — form phải cảnh báo trước khi gửi.
 */
export const ASSET_RETURN_CONDITION_OPTIONS = ["Good", "Damaged", "Lost"] as const;

export const ASSET_INVENTORY_RESULT_OPTIONS = ["Found", "Missing", "Not Checked"] as const;

/** Đánh dấu dòng kiểm kê chỉ nhận 2 giá trị — `Not Checked` là trạng thái ĐẦU, không đặt lại được. */
export const ASSET_INVENTORY_MARK_OPTIONS = ["Found", "Missing"] as const;

/** `reason` tối thiểu 3 ký tự cho thanh lý/mất/tìm-thấy-lại (ASSET-ERR-009). */
export const ASSET_REASON_MIN_LENGTH = 3;

/**
 * Màu badge theo trạng thái. `Disposed`/`Lost` = trạng thái CUỐI (không đảo ngược trừ Lost → In Stock
 * qua «Tìm thấy lại») nên dùng muted/danger để phân biệt rõ với vòng đời đang chạy.
 */
export const ASSET_STATUS_BADGE_VARIANT: Readonly<
  Record<AssetStatusOption, "success" | "brand" | "warning" | "muted" | "danger">
> = {
  "In Stock": "success",
  Assigned: "brand",
  "Under Maintenance": "warning",
  Disposed: "muted",
  Lost: "danger",
};

export const ASSET_INVENTORY_RESULT_BADGE_VARIANT: Readonly<
  Record<(typeof ASSET_INVENTORY_RESULT_OPTIONS)[number], "success" | "danger" | "muted">
> = {
  Found: "success",
  Missing: "danger",
  "Not Checked": "muted",
};

/** Kích thước trang mặc định — khớp `ASSET_PAGE_DEFAULT` của contracts (max 100). */
export const ASSET_PAGE_SIZE = 20;

/** Trần số dòng cho một lần `bulk-mark` (khớp `ASSET_BULK_MARK_MAX` của contracts). */
export const ASSET_BULK_MARK_LIMIT = 200;
