import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
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
import { employeeProfiles } from "./employees";
import { orgUnits, teams } from "./org";
import { users } from "./users";

/**
 * platforms — catalog nền tảng dùng chung (GLOBAL, KHÔNG company_id, KHÔNG RLS tenant).
 * DDL/seed ở migration 0021. app/worker chỉ SELECT.
 */
export const platforms = pgTable(
  "platforms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    type: text("type"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("platforms_code_uq").on(t.code),
    check(
      "platforms_code_check",
      sql`code IN ('youtube','tiktok','facebook','instagram','podcast','website')`,
    ),
    check("platforms_status_check", sql`status IN ('active','inactive')`),
  ],
);

export type Platform = typeof platforms.$inferSelect;
export type NewPlatform = typeof platforms.$inferInsert;

/**
 * channels — kênh đa nền tảng (ERD full sau G6-1). DDL/RLS/grant: 0007 + ALTER 0021.
 * `platform` (text, legacy 0007) giữ tạm cho rollback; `platform_id` là FK thật (DROP text ở 0029).
 * Channel-health (health_status/health_score/health_note) sống ngay trên channels. Soft-delete: deleted_at.
 */
export const channels = pgTable(
  "channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    platform: text("platform").notNull(), // legacy text (0007) — giữ tới migration dọn 0029
    platformId: uuid("platform_id")
      .notNull()
      .references(() => platforms.id, { onDelete: "restrict" }),
    code: text("code"),
    url: text("url"),
    language: text("language"),
    targetCountry: text("target_country"),
    niche: text("niche"),
    channelManagerId: uuid("channel_manager_id").references(() => users.id, {
      onDelete: "set null",
    }),
    primaryTeamId: uuid("primary_team_id").references(() => teams.id, { onDelete: "set null" }),
    healthStatus: text("health_status"),
    healthScore: numeric("health_score", { precision: 5, scale: 2 }),
    healthNote: text("health_note"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("channels_company_id_idx").on(t.companyId),
    index("channels_platform_id_idx").on(t.platformId),
    index("channels_manager_idx").on(t.companyId, t.channelManagerId),
    index("channels_company_status_idx").on(t.companyId, t.status),
    uniqueIndex("channels_company_name_active_uq")
      .on(t.companyId, t.name)
      .where(sql`deleted_at IS NULL`),
    uniqueIndex("channels_company_code_active_uq")
      .on(t.companyId, t.code)
      .where(sql`deleted_at IS NULL AND code IS NOT NULL`),
    check(
      "channels_platform_check",
      sql`platform IN ('youtube','tiktok','facebook','instagram','podcast','website')`,
    ),
    check(
      "channels_status_check",
      sql`status IN ('active','testing','paused','stopped','archived')`,
    ),
    check(
      "channels_health_status_check",
      sql`health_status IS NULL OR health_status IN ('healthy','watching','declining','risk','paused','stopped')`,
    ),
  ],
);

export type Channel = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;

/**
 * channel_members — user phụ trách 1 kênh + role + permission_level. DDL/RLS: 0021. Soft-delete.
 */
export const channelMembers = pgTable(
  "channel_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleInChannel: text("role_in_channel"),
    permissionLevel: text("permission_level"),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    leftAt: timestamp("left_at", { withTimezone: true }),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("channel_members_company_id_idx").on(t.companyId),
    index("channel_members_channel_id_idx").on(t.channelId),
    index("channel_members_user_id_idx").on(t.userId),
    uniqueIndex("channel_members_active_uq")
      .on(t.companyId, t.channelId, t.userId)
      .where(sql`deleted_at IS NULL`),
    check(
      "channel_members_role_check",
      sql`role_in_channel IS NULL OR role_in_channel IN ('channel_manager','seo','uploader','content_lead','production_lead','finance_viewer','qa')`,
    ),
    check("channel_members_status_check", sql`status IN ('active','inactive')`),
  ],
);

export type ChannelMember = typeof channelMembers.$inferSelect;
export type NewChannelMember = typeof channelMembers.$inferInsert;

/**
 * bytea — cột nhị phân (drizzle pg-core không export sẵn). Dùng cho envelope encryption (G6-2).
 * node-postgres trả/nhận Buffer cho bytea.
 */
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/**
 * platform_accounts (🔒 G6-2 CROWN-JEWEL) — tài khoản nền tảng + envelope encryption (ADR-0004).
 * 8 cột envelope (ERD v2 §2.1): secret_ciphertext thay encrypted_password. Mã hoá PHÍA APP (apps/api/src/crypto/),
 * KHÔNG pgcrypto. RLS+FORCE + worker policy (rotation) + column-grant — DDL ở migration 0022.
 * secret_ciphertext + recovery_email/phone + two_factor_note KHÔNG vào default DTO (mask query-projection, ép RED 7/10).
 */
export const platformAccounts = pgTable(
  "platform_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    platformId: uuid("platform_id")
      .notNull()
      .references(() => platforms.id, { onDelete: "restrict" }),
    accountName: text("account_name"),
    accountEmail: text("account_email"),
    accountIdentifier: text("account_identifier"),
    recoveryEmail: text("recovery_email"), // ⚠️ PII nhạy — KHÔNG vào DTO role không quyền
    recoveryPhone: text("recovery_phone"), // ⚠️ PII nhạy
    twoFactorNote: text("two_factor_note"), // ⚠️ hint nhạy
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    securityLevel: text("security_level"),
    status: text("status").notNull().default("active"),
    // 🔒 ENVELOPE columns (ERD v2 §2.1) — secret_ciphertext thay encrypted_password:
    secretCiphertext: bytea("secret_ciphertext").notNull(),
    encryptedDek: bytea("encrypted_dek").notNull(),
    dekKeyVersion: integer("dek_key_version").notNull(),
    kmsKeyId: text("kms_key_id").notNull(),
    ivNonce: bytea("iv_nonce").notNull(),
    authTag: bytea("auth_tag").notNull(),
    encAlgo: text("enc_algo").notNull().default("AES-256-GCM"),
    lastRotatedAt: timestamp("last_rotated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("platform_accounts_company_id_idx").on(t.companyId),
    index("platform_accounts_platform_id_idx").on(t.platformId),
    index("platform_accounts_owner_idx").on(t.companyId, t.ownerUserId),
    check("platform_accounts_enc_algo_check", sql`enc_algo IN ('AES-256-GCM')`),
    check("platform_accounts_status_check", sql`status IN ('active','inactive','suspended')`),
    check("platform_accounts_iv_nonce_len_check", sql`octet_length(iv_nonce) = 12`),
    check("platform_accounts_auth_tag_len_check", sql`octet_length(auth_tag) = 16`),
  ],
);

export type PlatformAccount = typeof platformAccounts.$inferSelect;
export type NewPlatformAccount = typeof platformAccounts.$inferInsert;

/**
 * encryption_keys — registry KEK/rotation GLOBAL (KHÔNG company_id, KHÔNG RLS). kms_key_id = Vault key PATH,
 * KHÔNG phải key material. app chỉ SELECT; worker (rotation) ghi. DDL/seed ở 0022 (+ auth_reset_token ở 0028).
 */
export const encryptionKeys = pgTable(
  "encryption_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    keyVersion: integer("key_version").notNull(),
    kmsKeyId: text("kms_key_id").notNull(),
    purpose: text("purpose").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("encryption_keys_purpose_version_uq").on(t.purpose, t.keyVersion),
    check("encryption_keys_purpose_check", sql`purpose IN ('platform_account','auth_reset_token')`),
    check("encryption_keys_status_check", sql`status IN ('active','retiring','revoked')`),
  ],
);

export type EncryptionKey = typeof encryptionKeys.$inferSelect;
export type NewEncryptionKey = typeof encryptionKeys.$inferInsert;

/**
 * channel_accounts — M:N channel ↔ platform_account. Link thuần (phương án A): KHÔNG status,
 * relation_type immutable, hard-DELETE (KHÔNG UPDATE grant). uq dẫn đầu company_id. DDL/RLS ở 0022.
 */
export const channelAccounts = pgTable(
  "channel_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    platformAccountId: uuid("platform_account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull().default("main_google_account"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("channel_accounts_company_id_idx").on(t.companyId),
    index("channel_accounts_channel_id_idx").on(t.channelId),
    index("channel_accounts_account_id_idx").on(t.platformAccountId),
    uniqueIndex("channel_accounts_uq").on(
      t.companyId,
      t.channelId,
      t.platformAccountId,
      t.relationType,
    ),
    check(
      "channel_accounts_relation_check",
      sql`relation_type IN
    ('main_google_account','recovery_email','adsense','analytics',
     'youtube_channel_account','tiktok_account','facebook_page')`,
    ),
  ],
);

export type ChannelAccount = typeof channelAccounts.$inferSelect;
export type NewChannelAccount = typeof channelAccounts.$inferInsert;

/**
 * projects — dự án sản xuất, thuộc 1 phòng ban (tuỳ chọn).
 */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    orgUnitId: uuid("org_unit_id").references(() => orgUnits.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    code: text("code"),
    projectType: text("project_type"),
    description: text("description"),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    projectManagerId: uuid("project_manager_id").references(() => users.id, {
      onDelete: "set null",
    }),
    startDate: date("start_date"),
    endDate: date("end_date"),
    priority: text("priority"),
    budget: numeric("budget", { precision: 18, scale: 2 }),
    status: text("status").notNull().default("active"),
    // PM-1 (apps/projects, mig 0420): mã prefix Plane (displayId {IDENT}-{seq}) + bộ đếm sequence/project.
    identifier: text("identifier"),
    lastTaskSequence: integer("last_task_sequence").notNull().default(0),
    // ── S4-TASK-BE-1 (mig 0478 §6, DB-06 §7.1): cột TitleCase MỚI additive NULLABLE — reconcile media-era → TASK.
    // GIỮ NGUYÊN status/priority/code/identifier lowercase legacy + CHECK/unique cũ ở trên (KHÔNG nới lỏng).
    // projectStatus/projectPriority TitleCase ≠ status/priority lowercase cũ. KHÔNG backfill (TASK-BE cut over).
    projectCode: text("project_code"),
    ownerEmployeeId: uuid("owner_employee_id").references(() => employeeProfiles.id, {
      onDelete: "set null",
    }),
    departmentId: uuid("department_id").references(() => orgUnits.id, { onDelete: "set null" }),
    projectPriority: text("project_priority"),
    projectStatus: text("project_status"),
    visibility: text("visibility"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: uuid("closed_by").references(() => users.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: uuid("archived_by").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    cancelReason: text("cancel_reason"),
    progressPercent: numeric("progress_percent", { precision: 5, scale: 2 }),
    metadata: jsonb("metadata"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("projects_company_id_idx").on(t.companyId),
    index("projects_org_unit_id_idx").on(t.orgUnitId),
    index("projects_company_status_idx").on(t.companyId, t.status),
    uniqueIndex("projects_company_name_active_uq")
      .on(t.companyId, t.name)
      .where(sql`deleted_at IS NULL`),
    uniqueIndex("projects_company_code_active_uq")
      .on(t.companyId, t.code)
      .where(sql`deleted_at IS NULL AND code IS NOT NULL`),
    uniqueIndex("projects_company_identifier_active_uq")
      .on(t.companyId, sql`upper(identifier)`)
      .where(sql`deleted_at IS NULL AND identifier IS NOT NULL`),
    check("projects_status_check", sql`status IN ('active', 'paused', 'archived')`),
    check(
      "projects_type_check",
      sql`project_type IS NULL OR project_type IN
    ('content_production','channel_operation','growth_campaign','recruitment',
     'training','finance','office_internal','equipment')`,
    ),
    check(
      "projects_priority_check",
      sql`priority IS NULL OR priority IN ('low','medium','high','urgent')`,
    ),
    // ── S4-TASK-BE-1 (mig 0478 §6): CHECK + index CỘT MỚI TitleCase (NULL hợp lệ). Legacy CHECK/unique giữ nguyên.
    uniqueIndex("uq_projects_company_project_code_active")
      .on(t.companyId, t.projectCode)
      .where(sql`deleted_at IS NULL AND project_code IS NOT NULL`),
    index("idx_projects_company_project_status")
      .on(t.companyId, t.projectStatus, t.startDate.desc())
      .where(sql`deleted_at IS NULL`),
    index("idx_projects_company_owner_employee")
      .on(t.companyId, t.ownerEmployeeId, t.projectStatus)
      .where(sql`deleted_at IS NULL`),
    check(
      "chk_projects_project_priority",
      sql`project_priority IS NULL OR project_priority IN ('Low','Medium','High','Urgent')`,
    ),
    check(
      "chk_projects_project_status",
      sql`project_status IS NULL OR project_status IN ('Planning','Active','On Hold','Completed','Cancelled','Archived')`,
    ),
    check(
      "chk_projects_visibility",
      sql`visibility IS NULL OR visibility IN ('Private','Internal','Public')`,
    ),
    check(
      "chk_projects_progress_percent",
      sql`progress_percent IS NULL OR (progress_percent >= 0 AND progress_percent <= 100)`,
    ),
  ],
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

/**
 * project_channels — nhiều kênh cho 1 project (M:N). Không có deleted_at — dùng DELETE thuần.
 * `status`/`role_in_project` mutable (PATCH) → app role có GRANT UPDATE (0023). Unique dẫn đầu company_id (fix-forward 0023).
 */
export const projectChannels = pgTable(
  "project_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    roleInProject: text("role_in_project"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("project_channels_project_id_idx").on(t.projectId),
    index("project_channels_channel_id_idx").on(t.channelId),
    uniqueIndex("project_channels_uq").on(t.companyId, t.projectId, t.channelId),
    check("project_channels_status_check", sql`status IN ('active','inactive')`),
  ],
);

export type ProjectChannel = typeof projectChannels.$inferSelect;
export type NewProjectChannel = typeof projectChannels.$inferInsert;

/**
 * project_teams — team gắn vào project (M:N). Pure hard-DELETE link (role immutable; re-link để đổi) →
 * KHÔNG status, KHÔNG deleted_at, KHÔNG UPDATE grant. DDL/RLS: 0023.
 */
export const projectTeams = pgTable(
  "project_teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    roleInProject: text("role_in_project"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("project_teams_company_id_idx").on(t.companyId),
    index("project_teams_project_id_idx").on(t.projectId),
    index("project_teams_team_id_idx").on(t.teamId),
    uniqueIndex("project_teams_uq").on(t.companyId, t.projectId, t.teamId),
  ],
);

export type ProjectTeam = typeof projectTeams.$inferSelect;
export type NewProjectTeam = typeof projectTeams.$inferInsert;

/**
 * project_members — user trong project + role + workload (PRJ-003/004). Soft-delete: deleted_at.
 * `status` mutable + soft-delete → app role có GRANT UPDATE (0023). DDL/RLS: 0023.
 */
export const projectMembers = pgTable(
  "project_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleInProject: text("role_in_project"),
    permissionLevel: text("permission_level"),
    workloadPercent: numeric("workload_percent", { precision: 5, scale: 2 }),
    startDate: date("start_date"),
    endDate: date("end_date"),
    status: text("status").notNull().default("active"),
    // ── S4-TASK-BE-1 (mig 0478 §7, DB-06 §7.2): cột MỚI additive NULLABLE — reconcile media-era → TASK.
    // GIỮ NGUYÊN user_id NOT NULL + status/CHECK + project_members_active_uq(company,project,user_id) legacy
    // ở dưới (KHÔNG nới lỏng). employeeId/memberStatus/projectRole là CỘT MỚI; user→employee cut over ở TASK-BE.
    employeeId: uuid("employee_id").references(() => employeeProfiles.id, { onDelete: "set null" }),
    projectRole: text("project_role"),
    memberStatus: text("member_status"),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    leftAt: timestamp("left_at", { withTimezone: true }),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    removedBy: uuid("removed_by").references(() => users.id, { onDelete: "set null" }),
    removeReason: text("remove_reason"),
    metadata: jsonb("metadata"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("project_members_company_id_idx").on(t.companyId),
    index("project_members_project_id_idx").on(t.projectId),
    index("project_members_user_id_idx").on(t.userId),
    // LEGACY LIVE (KHÔNG nới lỏng): partial-unique trên user_id — guard writer cũ (S4-TASK-BE dedupe 2 unique).
    uniqueIndex("project_members_active_uq")
      .on(t.companyId, t.projectId, t.userId)
      .where(sql`deleted_at IS NULL`),
    check("project_members_status_check", sql`status IN ('active','inactive')`),
    // ── S4-TASK-BE-1 (mig 0478 §7): partial-unique MỚI đo bằng employee_id + member_status='Active' (guard
    // employee_id IS NOT NULL — hàng legacy employee_id NULL chưa enforce) + CHECK cột MỚI (NULL hợp lệ).
    uniqueIndex("uq_project_members_active_employee")
      .on(t.companyId, t.projectId, t.employeeId)
      .where(sql`deleted_at IS NULL AND member_status = 'Active' AND employee_id IS NOT NULL`),
    index("idx_project_members_employee_status")
      .on(t.companyId, t.employeeId, t.memberStatus)
      .where(sql`deleted_at IS NULL`),
    index("idx_project_members_project_role")
      .on(t.companyId, t.projectId, t.projectRole, t.memberStatus)
      .where(sql`deleted_at IS NULL`),
    check(
      "chk_project_members_project_role",
      sql`project_role IS NULL OR project_role IN ('Owner','Manager','Member','Viewer')`,
    ),
    check(
      "chk_project_members_member_status",
      sql`member_status IS NULL OR member_status IN ('Active','Inactive','Removed')`,
    ),
  ],
);

export type ProjectMember = typeof projectMembers.$inferSelect;
export type NewProjectMember = typeof projectMembers.$inferInsert;

/**
 * content_types — loại nội dung (video dài / short / social post …) per-tenant. DDL/RLS: 0024. Soft-delete.
 * `default_workflow_template_id`/`default_evaluation_template_id` = uuid TRẦN (KHÔNG FK ở M2; defer G7/G8).
 */
export const contentTypes = pgTable(
  "content_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code"),
    description: text("description"),
    defaultWorkflowTemplateId: uuid("default_workflow_template_id"), // NO FK (defer G7)
    defaultEvaluationTemplateId: uuid("default_evaluation_template_id"), // NO FK (defer G8)
    targetPlatform: text("target_platform"),
    standardDuration: integer("standard_duration"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("content_types_company_id_idx").on(t.companyId),
    uniqueIndex("content_types_company_name_active_uq")
      .on(t.companyId, t.name)
      .where(sql`deleted_at IS NULL`),
    uniqueIndex("content_types_company_code_active_uq")
      .on(t.companyId, t.code)
      .where(sql`deleted_at IS NULL AND code IS NOT NULL`),
    check("content_types_status_check", sql`status IN ('active','inactive')`),
  ],
);

export type ContentType = typeof contentTypes.$inferSelect;
export type NewContentType = typeof contentTypes.$inferInsert;

/**
 * content_items — nội dung (video/short/social…) thuộc 1 project. ERD-full sau G6-4 (ALTER 0025).
 * `content_type` text (0007) ĐÃ DROP → `content_type_id` FK content_types (nullable, ON DELETE SET NULL).
 * `status` (workflow-lite, 0007) GIỮ NGUYÊN; `production_status` (10-value) TÁCH riêng. Soft-delete.
 */
export const contentItems = pgTable(
  "content_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    contentTypeId: uuid("content_type_id").references(() => contentTypes.id, {
      onDelete: "set null",
    }),
    code: text("code"),
    description: text("description"),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    mainChannelId: uuid("main_channel_id").references(() => channels.id, { onDelete: "set null" }),
    language: text("language"),
    status: text("status").notNull().default("draft"),
    productionStatus: text("production_status"),
    plannedPublishAt: timestamp("planned_publish_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    finalUrl: text("final_url"),
    thumbnailUrl: text("thumbnail_url"),
    scriptUrl: text("script_url"),
    videoFileUrl: text("video_file_url"),
    priority: text("priority"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("content_items_company_id_idx").on(t.companyId),
    index("content_items_project_id_idx").on(t.projectId),
    index("content_items_content_type_id_idx").on(t.contentTypeId),
    index("content_items_main_channel_idx").on(t.companyId, t.mainChannelId, t.productionStatus),
    index("content_items_project_status_idx").on(t.companyId, t.projectId, t.status),
    uniqueIndex("content_items_company_code_active_uq")
      .on(t.companyId, t.code)
      .where(sql`deleted_at IS NULL AND code IS NOT NULL`),
    check(
      "content_items_status_check",
      sql`status IN ('draft', 'in_production', 'review', 'approved', 'published')`,
    ),
    check(
      "content_items_production_status_check",
      sql`production_status IS NULL OR production_status IN
    ('idea','planning','in_production','waiting_review','revision','approved',
     'scheduled','published','analyzed','cancelled')`,
    ),
    check(
      "content_items_priority_check",
      sql`priority IS NULL OR priority IN ('low','medium','high','urgent')`,
    ),
  ],
);

export type ContentItem = typeof contentItems.$inferSelect;
export type NewContentItem = typeof contentItems.$inferInsert;

/**
 * content_channels — 1 content đăng đa kênh (CNT-002): mỗi kênh có publish status/url/lịch riêng.
 * DDL/RLS: 0026. Mutable (publish_status/url) → GRANT UPDATE. Unique dẫn đầu company_id.
 */
export const contentChannels = pgTable(
  "content_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    contentItemId: uuid("content_item_id")
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    platformId: uuid("platform_id").references(() => platforms.id, { onDelete: "restrict" }),
    publishStatus: text("publish_status"),
    publishUrl: text("publish_url"),
    plannedPublishAt: timestamp("planned_publish_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("content_channels_company_id_idx").on(t.companyId),
    index("content_channels_content_id_idx").on(t.contentItemId),
    index("content_channels_publish_idx").on(t.companyId, t.channelId, t.publishStatus),
    uniqueIndex("content_channels_uq").on(t.companyId, t.contentItemId, t.channelId),
    check(
      "content_channels_publish_status_check",
      sql`publish_status IS NULL OR publish_status IN ('not_scheduled','scheduled','publishing','published','failed','removed')`,
    ),
  ],
);

export type ContentChannel = typeof contentChannels.$inferSelect;
export type NewContentChannel = typeof contentChannels.$inferInsert;

/**
 * content_assets — asset + version chain (CNT-003, ERD v2 §11). Cấm hard-delete version cũ (chỉ flip
 * is_current=false + superseded_by). v1: version_group_id = id, parent_asset_id NULL (anchor, ép ở service).
 * one-current uq WHERE is_current AND deleted_at IS NULL. Soft-delete bản current PHẢI flip is_current cùng tx.
 */
export const contentAssets = pgTable(
  "content_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    contentItemId: uuid("content_item_id")
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),
    assetType: text("asset_type"),
    name: text("name"),
    fileUrl: text("file_url"),
    externalUrl: text("external_url"),
    version: integer("version").notNull().default(1),
    versionGroupId: uuid("version_group_id").notNull(),
    parentAssetId: uuid("parent_asset_id"),
    isCurrent: boolean("is_current").notNull().default(true),
    supersededBy: uuid("superseded_by"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("content_assets_company_id_idx").on(t.companyId),
    index("content_assets_content_id_idx").on(t.contentItemId),
    index("content_assets_version_group_idx").on(t.versionGroupId),
    uniqueIndex("content_assets_one_current_uq")
      .on(t.companyId, t.versionGroupId)
      .where(sql`is_current AND deleted_at IS NULL`),
    check(
      "content_assets_type_check",
      sql`asset_type IS NULL OR asset_type IN ('script','voice','raw_video','edited_video','thumbnail','seo_document','reference','final_output')`,
    ),
    check("content_assets_status_check", sql`status IN ('active','archived')`),
  ],
);

export type ContentAsset = typeof contentAssets.$inferSelect;
export type NewContentAsset = typeof contentAssets.$inferInsert;
