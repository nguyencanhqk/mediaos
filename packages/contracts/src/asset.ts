import { z } from "zod";

/**
 * S11-ASSET-DB-1 — enum chuẩn module ASSET (SPEC-13 · DB-15 §7). NGUỒN SỰ THẬT cho DTO của S11-ASSET-BE-1.
 *
 * MỖI enum dưới đây MIRROR ĐÚNG BẰNG một CHECK của migration 0549 — HAI CHIỀU: không chặt hơn (giá trị DB
 * hợp lệ mà Zod từ chối ⇒ 400 oan), không lỏng hơn (Zod cho qua mà DB từ chối ⇒ 500 unique/check-violation
 * vô danh — bài học `contract-must-mirror-db-check-both-directions`). Pin hai chiều ở `asset.spec.ts`
 * (mảng literal chép từ migration, cố ý KHÔNG import từ schema drizzle).
 *
 * Chỉ ENUM ở WO DB (chưa có consumer DTO); request/response schema viết ở WO BE cùng API-14.
 */

/** `chk_assets_status` — SPEC-01 §17.8. FSM chuyển tiếp ép ở service. */
export const assetLifecycleStatusSchema = z.enum([
  "In Stock",
  "Assigned",
  "Under Maintenance",
  "Disposed",
  "Lost",
]);
export type AssetLifecycleStatusDto = z.infer<typeof assetLifecycleStatusSchema>;

/** `chk_asset_assignments_status` — SPEC-01 §17.9. */
export const assetAssignmentStatusSchema = z.enum(["Active", "Returned"]);
export type AssetAssignmentStatusDto = z.infer<typeof assetAssignmentStatusSchema>;

/** `chk_asset_assignments_issue` — tình trạng lúc giao. */
export const assetIssueConditionSchema = z.enum(["Good", "Damaged"]);
export type AssetIssueConditionDto = z.infer<typeof assetIssueConditionSchema>;

/** `chk_asset_assignments_return` — tình trạng lúc thu hồi (`Lost` ⇒ tài sản sang `Lost`). */
export const assetReturnConditionSchema = z.enum(["Good", "Damaged", "Lost"]);
export type AssetReturnConditionDto = z.infer<typeof assetReturnConditionSchema>;

/** `chk_asset_maintenances_status`. */
export const assetMaintenanceStatusSchema = z.enum(["Open", "Closed"]);
export type AssetMaintenanceStatusDto = z.infer<typeof assetMaintenanceStatusSchema>;

/** `chk_asset_inventories_status`. */
export const assetInventoryStatusSchema = z.enum(["Open", "Closed"]);
export type AssetInventoryStatusDto = z.infer<typeof assetInventoryStatusSchema>;

/** `chk_asset_inventory_items_result`. */
export const assetInventoryItemResultSchema = z.enum(["Found", "Missing", "Not Checked"]);
export type AssetInventoryItemResultDto = z.infer<typeof assetInventoryItemResultSchema>;

/**
 * `chk_asset_inventory_items_expected` — ảnh chụp trạng thái lúc mở đợt: TẬP CON 3 giá trị, CỐ Ý KHÔNG tái dùng
 * `assetLifecycleStatusSchema` (nguồn loại trừ `Disposed`/`Lost` — DB-15 §7). Service mở đợt phải lọc trước khi
 * `INSERT … SELECT`, nếu không DB ném 23514 (map ra mã ASSET-ERR, không 500).
 */
export const assetInventoryExpectedStatusSchema = z.enum([
  "In Stock",
  "Assigned",
  "Under Maintenance",
]);
export type AssetInventoryExpectedStatusDto = z.infer<typeof assetInventoryExpectedStatusSchema>;

/** Đích của hành động `('dispose','asset')` — chỉ Zod, không CHECK riêng (đích FSM). */
export const assetDisposeKindSchema = z.enum(["Disposed", "Lost"]);
export type AssetDisposeKindDto = z.infer<typeof assetDisposeKindSchema>;

/** `chk_asset_categories_prefix` — vào mã `TS-<PREFIX>-<seq>` (ASSET-DEC-004). */
export const ASSET_CODE_PREFIX_RE = /^[A-Z0-9]{2,6}$/;
