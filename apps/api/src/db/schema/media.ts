import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
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
    channelManagerId: uuid("channel_manager_id").references(() => users.id, { onDelete: "set null" }),
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
    check("channels_status_check", sql`status IN ('active','testing','paused','stopped','archived')`),
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
    projectManagerId: uuid("project_manager_id").references(() => users.id, { onDelete: "set null" }),
    startDate: date("start_date"),
    endDate: date("end_date"),
    priority: text("priority"),
    budget: numeric("budget", { precision: 18, scale: 2 }),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
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
    check("projects_status_check", sql`status IN ('active', 'paused', 'archived')`),
    check(
      "projects_type_check",
      sql`project_type IS NULL OR project_type IN
    ('content_production','channel_operation','growth_campaign','recruitment',
     'training','finance','office_internal','equipment')`,
    ),
    check("projects_priority_check", sql`priority IS NULL OR priority IN ('low','medium','high','urgent')`),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("project_members_company_id_idx").on(t.companyId),
    index("project_members_project_id_idx").on(t.projectId),
    index("project_members_user_id_idx").on(t.userId),
    uniqueIndex("project_members_active_uq")
      .on(t.companyId, t.projectId, t.userId)
      .where(sql`deleted_at IS NULL`),
    check("project_members_status_check", sql`status IN ('active','inactive')`),
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
    contentTypeId: uuid("content_type_id").references(() => contentTypes.id, { onDelete: "set null" }),
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
    check("content_items_priority_check", sql`priority IS NULL OR priority IN ('low','medium','high','urgent')`),
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
