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
} from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { contractTypes, jobLevels } from "./hr-master";
import { orgUnits } from "./org";
import { positions } from "./positions";
import { users } from "./users";

/**
 * employee_profiles — hồ sơ nhân sự đầy đủ.
 * ⚠️ base_salary là trường nhạy cảm: Service PHẢI mask theo quyền (view-salary permission)
 *    trước khi trả DTO. Không bao giờ trả base_salary cho role không có quyền.
 * DDL/RLS/grant ở migration 0018. Soft-delete: deleted_at.
 * direct_manager_id = shortcut FK (1 quản lý chính); EMR dùng cho đa quản lý/scope.
 * Service phải đồng bộ: set direct_manager_id → upsert EMR relation_type='direct_manager'.
 */
export const employeeProfiles = pgTable(
  "employee_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    // S2-HR-DB-1 (mig 0442): DB đã NỚI user_id → NULLABLE (employee tồn tại TRƯỚC khi gán account — DB-03 §7.2).
    // Drizzle GIỮ .notNull() TẠM tới S2-HR-BE-2 (rework innerJoin→LEFT JOIN + cho insert employee-không-user);
    // type chặt hơn DB = AN TOÀN (code hiện không insert NULL). unique (company_id,user_id) WHERE deleted_at IS NULL
    // vẫn chặn 2 employee active cùng user (NULL phân biệt trong unique index Postgres).
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    employeeCode: text("employee_code"),
    orgUnitId: uuid("org_unit_id").references(() => orgUnits.id, { onDelete: "set null" }),
    positionId: uuid("position_id").references(() => positions.id, { onDelete: "set null" }),
    // S2-HR-DB-1: FK master data DB-03 (nullable, additive). Giữ contractType text + baseSalary cũ (back-compat).
    jobLevelId: uuid("job_level_id").references(() => jobLevels.id, { onDelete: "set null" }),
    contractTypeId: uuid("contract_type_id").references(() => contractTypes.id, {
      onDelete: "set null",
    }),
    directManagerId: uuid("direct_manager_id").references(() => users.id, { onDelete: "set null" }),
    workType: text("work_type").notNull().default("offline"),
    employmentType: text("employment_type").notNull().default("full_time"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    contractType: text("contract_type"),
    baseSalary: numeric("base_salary", { precision: 18, scale: 2 }),
    salaryType: text("salary_type").notNull().default("monthly"),
    phone: text("phone"),
    avatarUrl: text("avatar_url"),
    notes: text("notes"),
    // S2-HR-BE-4 (mig 0451): 11 cột self-service NULLABLE additive (SPEC-03 §15.1). Approve áp được trọn
    // bộ field cho phép. identity_* nhạy cảm (§14.18) — gate quyền cao + mask DTO ở tầng Service (BẤT BIẾN #3).
    dateOfBirth: date("date_of_birth"),
    gender: text("gender"),
    maritalStatus: text("marital_status"),
    personalEmail: text("personal_email"),
    currentAddress: text("current_address"),
    permanentAddress: text("permanent_address"),
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),
    identityNumber: text("identity_number"),
    identityIssueDate: date("identity_issue_date"),
    identityIssuePlace: text("identity_issue_place"),
    status: text("status").notNull().default("active"),
    // G11: ca làm được gán (FK → work_schedules ở migration 0061; không .references() để tránh
    // import vòng employees ↔ hr). NULL = dùng ca mặc định công ty (is_default).
    workScheduleId: uuid("work_schedule_id"),
    schemaVersion: integer("schema_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("employee_profiles_company_id_idx").on(t.companyId),
    index("employee_profiles_user_id_idx").on(t.userId),
    uniqueIndex("employee_profiles_company_user_active_uq")
      .on(t.companyId, t.userId)
      .where(sql`deleted_at IS NULL`),
    uniqueIndex("employee_profiles_company_code_active_uq")
      .on(t.companyId, t.employeeCode)
      .where(sql`deleted_at IS NULL AND employee_code IS NOT NULL`),
    check("emp_work_type_check", sql`work_type IN ('offline','remote','hybrid')`),
    check(
      "emp_employment_type_check",
      sql`employment_type IN ('full_time','part_time','freelancer','intern','probation')`,
    ),
    check("emp_salary_type_check", sql`salary_type IN ('monthly','hourly','project')`),
    check("emp_status_check", sql`status IN ('active','inactive','resigned','terminated')`),
    // S2-HR-BE-4 (mig 0451): gender NULLABLE; giá trị SPEC-03 §15.1 Male/Female/Other.
    check("emp_gender_check", sql`gender IS NULL OR gender IN ('Male','Female','Other')`),
  ],
);

export type EmployeeProfile = typeof employeeProfiles.$inferSelect;
export type NewEmployeeProfile = typeof employeeProfiles.$inferInsert;

/**
 * employee_manager_relations — quan hệ quản lý đa chiều (đa quản lý / scope).
 * DDL/RLS/grant ở migration 0018. Soft-delete: deleted_at.
 */
export const employeeManagerRelations = pgTable(
  "employee_manager_relations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeUserId: uuid("employee_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    managerUserId: uuid("manager_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull(),
    scopeType: text("scope_type"),
    scopeId: uuid("scope_id"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("emr_company_id_idx").on(t.companyId),
    index("emr_employee_user_id_idx").on(t.employeeUserId),
    index("emr_manager_user_id_idx").on(t.managerUserId),
    check(
      "emr_relation_type_check",
      sql`relation_type IN ('direct_manager','project_manager','professional_manager','temporary_manager')`,
    ),
    check(
      "emr_scope_type_check",
      sql`scope_type IS NULL OR scope_type IN ('company','org_unit','project','team')`,
    ),
    check("emr_status_check", sql`status IN ('active','inactive')`),
    check("emr_no_self_manage", sql`employee_user_id <> manager_user_id`),
  ],
);

export type EmployeeManagerRelation = typeof employeeManagerRelations.$inferSelect;
export type NewEmployeeManagerRelation = typeof employeeManagerRelations.$inferInsert;

/**
 * employee_status_histories — log vòng đời trạng thái nhân viên (S2-HR-DB-1, mig 0442 / DB-03).
 * APPEND-ONLY (BẤT BIẾN #2): app role chỉ SELECT,INSERT — KHÔNG UPDATE/DELETE. RLS+FORCE company_id.
 * Mỗi lần đổi status (S2-HR-BE-2) ghi 1 hàng old→new + reason + changed_by trong cùng tx.
 */
export const employeeStatusHistories = pgTable(
  "employee_status_histories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employeeProfiles.id, { onDelete: "cascade" }),
    oldStatus: text("old_status"),
    newStatus: text("new_status").notNull(),
    reason: text("reason"),
    changedBy: uuid("changed_by").references(() => users.id, { onDelete: "set null" }),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("esh_company_employee_idx").on(t.companyId, t.employeeId)],
);

export type EmployeeStatusHistory = typeof employeeStatusHistories.$inferSelect;
export type NewEmployeeStatusHistory = typeof employeeStatusHistories.$inferInsert;

/**
 * profile_change_requests — yêu cầu cập nhật hồ sơ cá nhân (SPEC-03 §15.10, HR-FUNC-018/019).
 * Employee gửi yêu cầu; HR/Admin duyệt/từ chối → chỉ khi duyệt mới ghi vào employees.
 * SOFT-DELETE: không có deleted_at vì yêu cầu chỉ bị Cancelled/Rejected, không xóa.
 * APPEND-ONCE MUTATION: status chỉ tiến (Pending→Approved/Rejected/Cancelled) — KHÔNG giảm trạng thái.
 * Audit mọi thao tác vào audit_logs (object_type='profile_change_request').
 * DDL/RLS+FORCE/policy tenant_isolation/grant app+worker ở migration 0451 (band S2-HR-BE-4-FIX-DB).
 */
export const profileChangeRequests = pgTable(
  "profile_change_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    /** Mã yêu cầu (SPEC-03 §15.10 / DB-03 §7.9). NULLABLE — additive no-backfill; "id rút gọn" fallback. */
    requestCode: text("request_code"),
    /** Nhân viên sở hữu yêu cầu (link tới employee_profiles). */
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employeeProfiles.id, { onDelete: "cascade" }),
    /** User tạo yêu cầu (thường chính là user của employee, nhưng không bắt buộc). */
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Draft/Pending/Approved/Rejected/Cancelled. */
    status: text("status").notNull().default("Pending"),
    /** Snapshot giá trị cũ (JSON object field→value). BẤT BIẾN #3: mask identity_number/bank_account. */
    oldValues: jsonb("old_values").notNull().$type<Record<string, unknown>>(),
    /** Snapshot giá trị mới do Employee đề xuất. */
    newValues: jsonb("new_values").notNull().$type<Record<string, unknown>>(),
    /** Danh sách field thay đổi (array of field name strings). */
    changedFields: jsonb("changed_fields").notNull().$type<string[]>(),
    /** Lý do Employee gửi yêu cầu. */
    reason: text("reason"),
    /** Lý do từ chối của HR (bắt buộc khi Rejected). */
    rejectionReason: text("rejection_reason"),
    /** User đã duyệt/từ chối. */
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    /** Thời gian HR xử lý. */
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    /** Thời gian Employee gửi (Pending). */
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    /** Thời gian Employee hủy. */
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pcr_company_id_idx").on(t.companyId),
    index("pcr_employee_id_idx").on(t.employeeId),
    index("pcr_status_idx").on(t.companyId, t.status),
    index("pcr_requested_by_idx").on(t.requestedBy),
    uniqueIndex("pcr_company_request_code_uq")
      .on(t.companyId, t.requestCode)
      .where(sql`request_code IS NOT NULL`),
    check("pcr_status_check", sql`status IN ('Draft','Pending','Approved','Rejected','Cancelled')`),
    check("pcr_rejection_reason_check", sql`status <> 'Rejected' OR rejection_reason IS NOT NULL`),
  ],
);

export type ProfileChangeRequest = typeof profileChangeRequests.$inferSelect;
export type NewProfileChangeRequest = typeof profileChangeRequests.$inferInsert;

/**
 * employee_profile_change_histories — log áp-dụng từng field khi yêu cầu hồ sơ được Approved
 * (S2-HR-BE-4, mig 0451). APPEND-ONLY (BẤT BIẾN #2): app role chỉ SELECT,INSERT — KHÔNG UPDATE/DELETE.
 * RLS+FORCE company_id. Mirror employee_status_histories. Mỗi field áp xong ghi 1 hàng old→new +
 * is_sensitive + changed_by trong cùng tx duyệt. BẤT BIẾN #3: identity_number KHÔNG ghi plaintext.
 */
export const employeeProfileChangeHistories = pgTable(
  "employee_profile_change_histories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employeeProfiles.id, { onDelete: "cascade" }),
    /** Yêu cầu nguồn (NULL nếu HR sửa trực tiếp ngoài luồng self-service). */
    requestId: uuid("request_id").references(() => profileChangeRequests.id, {
      onDelete: "set null",
    }),
    fieldName: text("field_name").notNull(),
    oldValue: jsonb("old_value").$type<unknown>(),
    newValue: jsonb("new_value").$type<unknown>(),
    isSensitive: boolean("is_sensitive").notNull().default(false),
    changedBy: uuid("changed_by").references(() => users.id, { onDelete: "set null" }),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("epch_company_employee_idx").on(t.companyId, t.employeeId),
    index("epch_request_idx").on(t.requestId),
  ],
);

export type EmployeeProfileChangeHistory = typeof employeeProfileChangeHistories.$inferSelect;
export type NewEmployeeProfileChangeHistory = typeof employeeProfileChangeHistories.$inferInsert;
