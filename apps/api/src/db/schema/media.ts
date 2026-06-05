import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { orgUnits } from "./org";

/**
 * channels — kênh mạng xã hội của công ty.
 * DDL/RLS/grant ở migration 0007. Soft-delete: deleted_at.
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
    platform: text("platform").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("channels_company_id_idx").on(t.companyId),
    uniqueIndex("channels_company_name_active_uq")
      .on(t.companyId, t.name)
      .where(sql`deleted_at IS NULL`),
    check("channels_platform_check", sql`platform IN ('youtube', 'tiktok', 'facebook', 'instagram')`),
    check("channels_status_check", sql`status IN ('active', 'inactive')`),
  ],
);

export type Channel = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;

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
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("projects_company_id_idx").on(t.companyId),
    index("projects_org_unit_id_idx").on(t.orgUnitId),
    uniqueIndex("projects_company_name_active_uq")
      .on(t.companyId, t.name)
      .where(sql`deleted_at IS NULL`),
    check("projects_status_check", sql`status IN ('active', 'paused', 'archived')`),
  ],
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

/**
 * project_channels — nhiều kênh cho 1 project (M:N). Không có deleted_at — dùng DELETE thuần.
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("project_channels_project_id_idx").on(t.projectId),
    index("project_channels_channel_id_idx").on(t.channelId),
    uniqueIndex("project_channels_uq").on(t.projectId, t.channelId),
  ],
);

export type ProjectChannel = typeof projectChannels.$inferSelect;
export type NewProjectChannel = typeof projectChannels.$inferInsert;

/**
 * content_items — video / short / reel thuộc 1 project. Soft-delete: deleted_at.
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
    contentType: text("content_type").notNull().default("video"),
    status: text("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("content_items_company_id_idx").on(t.companyId),
    index("content_items_project_id_idx").on(t.projectId),
    check("content_items_type_check", sql`content_type IN ('video', 'short', 'reel')`),
    check(
      "content_items_status_check",
      sql`status IN ('draft', 'in_production', 'review', 'approved', 'published')`,
    ),
  ],
);

export type ContentItem = typeof contentItems.$inferSelect;
export type NewContentItem = typeof contentItems.$inferInsert;
