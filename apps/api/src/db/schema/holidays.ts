import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { users } from "./users";

/**
 * FOUNDATION-DB-4 — public_holidays (DB-08 §8.10). DDL/RLS/grant ở migration 0434. Inference dưới đây
 * PARITY với migration (drizzle KHÔNG mô tả RLS/grant/partial-index — migration là nguồn sự thật).
 *
 * `company_id` NULLABLE (DB-08 §5.3): NULL = global holiday theo country_code (dùng chung); NOT NULL =
 * holiday riêng công ty (override global cùng ngày). RLS policy (mẫu 0005 roles):
 * USING (company_id = current_setting OR company_id IS NULL), WITH CHECK (company_id = current_setting)
 * — tenant ĐỌC holiday mình + global; app role CHỈ ghi holiday tenant mình, KHÔNG ghi global → KHÔNG rò
 * chéo tenant. Override: HolidayService ưu tiên holiday company rồi global (DB-08 §8.10 rule 1).
 *
 * Master-data mutable + soft-delete (KHÔNG hard-delete holiday đã dùng tính công/phép — DB-08 §8.10 rule 5).
 * App SELECT/INSERT/UPDATE; KHÔNG DELETE (BẤT BIẾN #2).
 *
 * holiday_type ∈ PublicHoliday/CompanyHoliday/WorkingDayOverride/SpecialDay · status ∈ Active/Inactive
 * (CHECK ở migration). uq global (country_code, holiday_date, holiday_code) WHERE company_id IS NULL; uq
 * company (company_id, holiday_date, holiday_code) WHERE company_id IS NOT NULL (partial — chỉ migration SQL).
 *
 * ⚠️ LỆCH SPEC tên cột: HỢP ĐỒNG WO dùng `is_paid_holiday`; DB-08 §8.10 bảng cột ghi `is_paid`. Theo WO.
 */
export const publicHolidays = pgTable(
  "public_holidays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // NULLABLE: global holiday = NULL (mẫu 0005 roles — KHÔNG .notNull(), KHÔNG default current_setting).
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    holidayCode: varchar("holiday_code", { length: 100 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    holidayDate: date("holiday_date").notNull(),
    holidayType: varchar("holiday_type", { length: 50 }).notNull().default("PublicHoliday"),
    countryCode: varchar("country_code", { length: 10 }),
    regionCode: varchar("region_code", { length: 50 }),
    isRecurring: boolean("is_recurring").notNull().default(false),
    recurringRule: jsonb("recurring_rule"),
    affectsAttendance: boolean("affects_attendance").notNull().default(true),
    affectsLeaveCalculation: boolean("affects_leave_calculation").notNull().default(true),
    // HỢP ĐỒNG WO: is_paid_holiday (DB-08 ghi is_paid). Ngữ nghĩa: ngày nghỉ có hưởng lương không.
    isPaidHoliday: boolean("is_paid_holiday").notNull().default(true),
    status: varchar("status", { length: 50 }).notNull().default("Active"),
    source: varchar("source", { length: 100 }),
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
    // Partial unique indexes (WHERE company_id IS [NOT] NULL AND deleted_at IS NULL) chỉ ở migration SQL —
    // drizzle parity bằng index thường để giữ inference cột; ràng buộc thật ép ở DB level.
    uniqueIndex("uq_public_holidays_global_date_code_active")
      .on(t.countryCode, t.holidayDate, t.holidayCode)
      .where(sql`company_id IS NULL AND deleted_at IS NULL`),
    uniqueIndex("uq_public_holidays_company_date_code_active")
      .on(t.companyId, t.holidayDate, t.holidayCode)
      .where(sql`company_id IS NOT NULL AND deleted_at IS NULL`),
    index("idx_public_holidays_company_date")
      .on(t.companyId, t.holidayDate, t.status)
      .where(sql`deleted_at IS NULL`),
    index("idx_public_holidays_country_date")
      .on(t.countryCode, t.holidayDate, t.status)
      .where(sql`deleted_at IS NULL`),
    index("public_holidays_company_id_idx").on(t.companyId),
  ],
);

export type PublicHoliday = typeof publicHolidays.$inferSelect;
export type NewPublicHoliday = typeof publicHolidays.$inferInsert;
