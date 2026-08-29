import { describe, expect, it } from "vitest";
import {
  ASSET_CODE_PREFIX_RE,
  assetAssignmentStatusSchema,
  assetDisposeKindSchema,
  assetInventoryExpectedStatusSchema,
  assetInventoryItemResultSchema,
  assetInventoryStatusSchema,
  assetIssueConditionSchema,
  assetMaintenanceStatusSchema,
  assetReturnConditionSchema,
  assetLifecycleStatusSchema,
} from "./asset";

/**
 * PIN HAI CHIỀU enum ↔ CHECK migration 0549 (DB-15 §7). Mảng bên dưới là LITERAL chép từ SQL — cố ý KHÔNG
 * import từ schema drizzle hay từ chính `asset.ts` (assert hằng số bằng chính nó là tautology). Đổi CHECK ở DB
 * ⇒ phải đổi cả đây lẫn enum, cùng commit.
 */
describe("contracts/asset — enum mirror CHECK 0549 đúng bằng", () => {
  it("assetLifecycleStatusSchema == chk_assets_status (5)", () => {
    expect(assetLifecycleStatusSchema.options).toEqual([
      "In Stock",
      "Assigned",
      "Under Maintenance",
      "Disposed",
      "Lost",
    ]);
  });

  it("assetAssignmentStatusSchema == chk_asset_assignments_status (2)", () => {
    expect(assetAssignmentStatusSchema.options).toEqual(["Active", "Returned"]);
  });

  it("assetIssueConditionSchema == chk_asset_assignments_issue (2)", () => {
    expect(assetIssueConditionSchema.options).toEqual(["Good", "Damaged"]);
  });

  it("assetReturnConditionSchema == chk_asset_assignments_return (3)", () => {
    expect(assetReturnConditionSchema.options).toEqual(["Good", "Damaged", "Lost"]);
  });

  it("assetMaintenanceStatusSchema == chk_asset_maintenances_status (2)", () => {
    expect(assetMaintenanceStatusSchema.options).toEqual(["Open", "Closed"]);
  });

  it("assetInventoryStatusSchema == chk_asset_inventories_status (2)", () => {
    expect(assetInventoryStatusSchema.options).toEqual(["Open", "Closed"]);
  });

  it("assetInventoryItemResultSchema == chk_asset_inventory_items_result (3)", () => {
    expect(assetInventoryItemResultSchema.options).toEqual(["Found", "Missing", "Not Checked"]);
  });

  it("assetInventoryExpectedStatusSchema == chk_asset_inventory_items_expected (3, TẬP CON — không 5)", () => {
    expect(assetInventoryExpectedStatusSchema.options).toEqual([
      "In Stock",
      "Assigned",
      "Under Maintenance",
    ]);
    expect(assetInventoryExpectedStatusSchema.safeParse("Disposed").success).toBe(false);
    expect(assetInventoryExpectedStatusSchema.safeParse("Lost").success).toBe(false);
  });

  it("assetDisposeKindSchema = đích FSM Disposed/Lost (chỉ Zod)", () => {
    expect(assetDisposeKindSchema.options).toEqual(["Disposed", "Lost"]);
  });

  it("ASSET_CODE_PREFIX_RE == chk_asset_categories_prefix ^[A-Z0-9]{2,6}$", () => {
    for (const ok of ["LT", "PC01", "ABCDEF", "99"])
      expect(ASSET_CODE_PREFIX_RE.test(ok)).toBe(true);
    for (const bad of ["A", "abc", "ABCDEFG", "A-B", "", "LT "]) {
      expect(ASSET_CODE_PREFIX_RE.test(bad)).toBe(false);
    }
  });
});
