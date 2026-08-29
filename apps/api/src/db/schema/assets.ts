import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { employeeProfiles } from "./employees";
import { users } from "./users";

/**
 * ASSET (DB-15 §6 / SPEC-13) — 6 bảng module quản lý tài sản. DDL/RLS+FORCE/policy/grant/composite tenant FK/
 * partial-index ở migration 0549 (seed role/quyền/audit 0550 · NOTI 0551). Inference dưới đây PARITY với migration
 * (Drizzle KHÔNG mô tả RLS/grant/policy/composite FK — migration là chuẩn). KHÔNG db:generate.
 *
 * company_id NOT NULL (BẤT BIẾN #1): RLS ENABLE + FORCE + policy tenant_isolation literal-GUC. Mọi query qua
 *   withTenant(companyId, fn). MỌI FK chéo bảng nghiệp vụ là COMPOSITE `(company_id, col) → parent(company_id, id)`
 *   ở SQL (KI-046 — kiểm tra FK của Postgres không áp RLS); `.references()` một cột dưới đây CHỈ để suy kiểu.
 *
 * BẤT BIẾN #2: 4 bảng SỔ (`asset_assignments` · `asset_maintenances` · `asset_inventories` ·
 *   `asset_inventory_items`) — app role SELECT/INSERT + UPDATE CẤP CỘT (cột "đóng"/"kết quả"), KHÔNG DELETE, KHÔNG
 *   deleted_at. 2 bảng mutable (`asset_categories` · `assets`) soft-delete = UPDATE, KHÔNG DELETE.
 *
 * ⚠️ BẢN ĐỒ TÊN DB-15 → QUAN HỆ THẬT: employees → employee_profiles. KHÔNG cột holder_employee_id trên assets —
 *   "ai đang giữ" dẫn xuất từ lượt Active (uq_asset_assignments_active).
 */
export const assetCategories = pgTable(
  "asset_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 30 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    // ^[A-Z0-9]{2,6}$ — vào mã TS-<PREFIX>-<seq>; khoá ở service sau mã đầu tiên (ASSET-ERR-010).
    codePrefix: varchar("code_prefix", { length: 6 }).notNull(),
    description: text("description"),
    defaultMaintenanceIntervalDays: integer("default_maintenance_interval_days"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("uq_asset_categories_company_code_active")
      .on(t.companyId, t.code)
      .where(sql`deleted_at IS NULL`),
    // CỐ Ý KHÔNG partial — prefix không bao giờ cấp lại (DB-15 §6.7).
    uniqueIndex("uq_asset_categories_company_prefix").on(t.companyId, t.codePrefix),
    index("idx_asset_categories_company_active")
      .on(t.companyId, t.isActive, t.sortOrder)
      .where(sql`deleted_at IS NULL`),
    check("chk_asset_categories_prefix", sql`code_prefix ~ '^[A-Z0-9]{2,6}$'`),
    check(
      "chk_asset_categories_interval",
      sql`default_maintenance_interval_days IS NULL OR default_maintenance_interval_days > 0`,
    ),
  ],
);

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => assetCategories.id),
    // qua sequence_counters (scope Custom theo category) — bất biến sau khi tạo.
    assetCode: varchar("asset_code", { length: 50 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    serialNumber: varchar("serial_number", { length: 120 }),
    brand: varchar("brand", { length: 120 }),
    model: varchar("model", { length: 120 }),
    purchaseDate: date("purchase_date"),
    // tài chính — chỉ trả ở scope Company (SPEC-13 §18); che ở service.
    purchasePrice: numeric("purchase_price", { precision: 18, scale: 2 }),
    supplier: varchar("supplier", { length: 255 }),
    warrantyEndDate: date("warranty_end_date"),
    location: varchar("location", { length: 255 }),
    conditionNote: text("condition_note"),
    // In Stock / Assigned / Under Maintenance / Disposed / Lost — FSM ép ở service (SPEC-01 §17.8).
    status: varchar("status", { length: 30 }).notNull().default("In Stock"),
    statusReason: text("status_reason"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    statusChangedBy: uuid("status_changed_by").references(() => users.id, { onDelete: "set null" }),
    nextMaintenanceDue: date("next_maintenance_due"),
    description: text("description"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("uq_assets_company_code_active")
      .on(t.companyId, t.assetCode)
      .where(sql`deleted_at IS NULL`),
    uniqueIndex("uq_assets_company_serial_active")
      .on(t.companyId, t.serialNumber)
      .where(sql`deleted_at IS NULL AND serial_number IS NOT NULL`),
    index("idx_assets_company_status_category")
      .on(t.companyId, t.status, t.categoryId)
      .where(sql`deleted_at IS NULL`),
    index("idx_assets_company_maintenance_due")
      .on(t.companyId, t.nextMaintenanceDue)
      .where(
        sql`deleted_at IS NULL AND next_maintenance_due IS NOT NULL AND status NOT IN ('Disposed', 'Lost')`,
      ),
    check(
      "chk_assets_status",
      sql`status IN ('In Stock', 'Assigned', 'Under Maintenance', 'Disposed', 'Lost')`,
    ),
    check("chk_assets_price", sql`purchase_price IS NULL OR purchase_price >= 0`),
    check(
      "chk_assets_warranty",
      sql`warranty_end_date IS NULL OR purchase_date IS NULL OR warranty_end_date >= purchase_date`,
    ),
  ],
);

/** Sổ cấp phát — app SELECT/INSERT + UPDATE(status, returned_*, return_*, updated_*); KHÔNG DELETE. */
export const assetAssignments = pgTable(
  "asset_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employeeProfiles.id),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    assignedBy: uuid("assigned_by").references(() => users.id),
    issueCondition: varchar("issue_condition", { length: 20 }),
    issueNote: text("issue_note"),
    expectedReturnDate: date("expected_return_date"),
    // Active / Returned (SPEC-01 §17.9).
    status: varchar("status", { length: 20 }).notNull().default("Active"),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    returnedBy: uuid("returned_by").references(() => users.id),
    returnCondition: varchar("return_condition", { length: 20 }),
    returnNote: text("return_note"),
    // chừa cấp phát 2 bước (ASSET-DEC-002) — v1 luôn NULL, KHÔNG trong column-grant.
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    // CHỐT CUỐI SPEC-13 §3.2: một tài sản một lượt đang sống.
    uniqueIndex("uq_asset_assignments_active")
      .on(t.companyId, t.assetId)
      .where(sql`status = 'Active'`),
    index("idx_asset_assignments_asset_time").on(t.companyId, t.assetId, t.assignedAt.desc()),
    index("idx_asset_assignments_employee_active")
      .on(t.companyId, t.employeeId)
      .where(sql`status = 'Active'`),
    index("idx_asset_assignments_employee_time").on(t.companyId, t.employeeId, t.assignedAt.desc()),
    check("chk_asset_assignments_status", sql`status IN ('Active', 'Returned')`),
    check(
      "chk_asset_assignments_issue",
      sql`issue_condition IS NULL OR issue_condition IN ('Good', 'Damaged')`,
    ),
    check(
      "chk_asset_assignments_return",
      sql`return_condition IS NULL OR return_condition IN ('Good', 'Damaged', 'Lost')`,
    ),
    // v1 (ASSET-DEC-002): acknowledged_at luôn NULL — CHECK chặn cả INSERT (column-grant chỉ chặn UPDATE).
    check("chk_asset_assignments_ack_v1", sql`acknowledged_at IS NULL`),
    check(
      "chk_asset_assignments_return_pair",
      sql`(status = 'Active'   AND returned_at IS NULL     AND return_condition IS NULL) OR
          (status = 'Returned' AND returned_at IS NOT NULL AND return_condition IS NOT NULL)`,
    ),
  ],
);

/** Sổ bảo trì — app SELECT/INSERT + UPDATE(status, closed_*, result_note, cost, next_due_date, updated_*). */
export const assetMaintenances = pgTable(
  "asset_maintenances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    openedBy: uuid("opened_by").references(() => users.id),
    reason: text("reason").notNull(),
    vendor: varchar("vendor", { length: 255 }),
    status: varchar("status", { length: 20 }).notNull().default("Open"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: uuid("closed_by").references(() => users.id),
    resultNote: text("result_note"),
    // tài chính — chỉ trả ở scope Company.
    cost: numeric("cost", { precision: 18, scale: 2 }),
    nextDueDate: date("next_due_date"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    uniqueIndex("uq_asset_maintenances_open")
      .on(t.companyId, t.assetId)
      .where(sql`status = 'Open'`),
    index("idx_asset_maintenances_asset_time").on(t.companyId, t.assetId, t.openedAt.desc()),
    check("chk_asset_maintenances_status", sql`status IN ('Open', 'Closed')`),
    check("chk_asset_maintenances_cost", sql`cost IS NULL OR cost >= 0`),
    check(
      "chk_asset_maintenances_close_pair",
      sql`(status = 'Open' AND closed_at IS NULL) OR (status = 'Closed' AND closed_at IS NOT NULL)`,
    ),
  ],
);

/** Sổ đợt kiểm kê — app SELECT/INSERT + UPDATE(status, closed_*, note, 4 số tổng kết, updated_*). */
export const assetInventories = pgTable(
  "asset_inventories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    // NULL = toàn bộ tài sản.
    categoryId: uuid("category_id").references(() => assetCategories.id),
    status: varchar("status", { length: 20 }).notNull().default("Open"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    openedBy: uuid("opened_by").references(() => users.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: uuid("closed_by").references(() => users.id),
    note: text("note"),
    // cache ghi MỘT LẦN lúc đóng (SPEC-13 §13.4); NULL khi còn Open.
    totalItems: integer("total_items"),
    foundCount: integer("found_count"),
    missingCount: integer("missing_count"),
    notCheckedCount: integer("not_checked_count"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    uniqueIndex("uq_asset_inventories_open")
      .on(t.companyId)
      .where(sql`status = 'Open'`),
    index("idx_asset_inventories_company_time").on(t.companyId, t.openedAt.desc()),
    check("chk_asset_inventories_status", sql`status IN ('Open', 'Closed')`),
    check(
      "chk_asset_inventories_close_pair",
      sql`(status = 'Open'   AND closed_at IS NULL     AND total_items IS NULL     AND found_count IS NULL
                             AND missing_count IS NULL AND not_checked_count IS NULL) OR
          (status = 'Closed' AND closed_at IS NOT NULL AND total_items IS NOT NULL AND found_count IS NOT NULL
                             AND missing_count IS NOT NULL AND not_checked_count IS NOT NULL
                             AND total_items = found_count + missing_count + not_checked_count)`,
    ),
  ],
);

/** Sổ dòng kiểm kê (ảnh chụp lúc mở đợt) — app SELECT/INSERT + UPDATE(result, checked_*, note, updated_*). */
export const assetInventoryItems = pgTable(
  "asset_inventory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    inventoryId: uuid("inventory_id")
      .notNull()
      .references(() => assetInventories.id),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    // ảnh chụp assets.status lúc mở — TẬP CON 3 giá trị (DB-15 §7).
    expectedStatus: varchar("expected_status", { length: 30 }).notNull(),
    expectedHolderEmployeeId: uuid("expected_holder_employee_id").references(
      () => employeeProfiles.id,
    ),
    // Found / Missing / Not Checked.
    result: varchar("result", { length: 20 }).notNull().default("Not Checked"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    checkedBy: uuid("checked_by").references(() => users.id),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    uniqueIndex("uq_asset_inventory_items_inventory_asset").on(
      t.companyId,
      t.inventoryId,
      t.assetId,
    ),
    index("idx_asset_inventory_items_inventory_result").on(t.companyId, t.inventoryId, t.result),
    check("chk_asset_inventory_items_result", sql`result IN ('Found', 'Missing', 'Not Checked')`),
    check(
      "chk_asset_inventory_items_expected",
      sql`expected_status IN ('In Stock', 'Assigned', 'Under Maintenance')`,
    ),
    check(
      "chk_asset_inventory_items_check_pair",
      sql`(result = 'Not Checked' AND checked_at IS NULL) OR (result <> 'Not Checked' AND checked_at IS NOT NULL)`,
    ),
  ],
);

export type AssetCategory = typeof assetCategories.$inferSelect;
export type NewAssetCategory = typeof assetCategories.$inferInsert;
export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;
export type AssetAssignment = typeof assetAssignments.$inferSelect;
export type NewAssetAssignment = typeof assetAssignments.$inferInsert;
export type AssetMaintenance = typeof assetMaintenances.$inferSelect;
export type NewAssetMaintenance = typeof assetMaintenances.$inferInsert;
export type AssetInventory = typeof assetInventories.$inferSelect;
export type NewAssetInventory = typeof assetInventories.$inferInsert;
export type AssetInventoryItem = typeof assetInventoryItems.$inferSelect;
export type NewAssetInventoryItem = typeof assetInventoryItems.$inferInsert;
