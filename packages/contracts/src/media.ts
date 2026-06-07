import { z } from "zod";

/** Mã nền tảng — khớp catalog `platforms` (0021) gồm 6 code. */
export const channelPlatformSchema = z.enum([
  "youtube",
  "tiktok",
  "facebook",
  "instagram",
  "podcast",
  "website",
]);
export type ChannelPlatform = z.infer<typeof channelPlatformSchema>;

export const channelStatusSchema = z.enum(["active", "testing", "paused", "stopped", "archived"]);
export type ChannelStatus = z.infer<typeof channelStatusSchema>;

export const channelHealthStatusSchema = z.enum([
  "healthy",
  "watching",
  "declining",
  "risk",
  "paused",
  "stopped",
]);
export type ChannelHealthStatus = z.infer<typeof channelHealthStatusSchema>;

/** Catalog nền tảng (read-only). */
export const platformSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: channelPlatformSchema,
  type: z.string().nullable(),
  status: z.enum(["active", "inactive"]),
});
export type PlatformDto = z.infer<typeof platformSchema>;

export const channelSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  name: z.string(),
  /** Cột text legacy (mirror platform_id; DROP ở 0029). */
  platform: channelPlatformSchema,
  platformId: z.string().uuid(),
  code: z.string().nullable(),
  url: z.string().nullable(),
  language: z.string().nullable(),
  targetCountry: z.string().nullable(),
  niche: z.string().nullable(),
  channelManagerId: z.string().uuid().nullable(),
  primaryTeamId: z.string().uuid().nullable(),
  healthStatus: channelHealthStatusSchema.nullable(),
  /** numeric(5,2) — Drizzle trả string. */
  healthScore: z.string().nullable(),
  healthNote: z.string().nullable(),
  status: channelStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ChannelDto = z.infer<typeof channelSchema>;

export const createChannelSchema = z.object({
  name: z.string().min(1).max(200),
  platform: channelPlatformSchema,
  code: z.string().max(80).optional(),
  url: z.string().url().max(500).optional(),
  language: z.string().max(20).optional(),
  targetCountry: z.string().max(80).optional(),
  niche: z.string().max(120).optional(),
  channelManagerId: z.string().uuid().optional(),
  primaryTeamId: z.string().uuid().optional(),
});
export type CreateChannelRequest = z.infer<typeof createChannelSchema>;

export const updateChannelSchema = z
  .object({
    name: z.string().min(1).max(200),
    platform: channelPlatformSchema,
    code: z.string().max(80).nullable(),
    url: z.string().url().max(500).nullable(),
    language: z.string().max(20).nullable(),
    targetCountry: z.string().max(80).nullable(),
    niche: z.string().max(120).nullable(),
    channelManagerId: z.string().uuid().nullable(),
    primaryTeamId: z.string().uuid().nullable(),
    status: channelStatusSchema,
  })
  .partial();
export type UpdateChannelRequest = z.infer<typeof updateChannelSchema>;

/** Cập nhật sức khỏe kênh (G6-5) — health_status/score/note (CH-003). */
export const updateChannelHealthSchema = z
  .object({
    healthStatus: channelHealthStatusSchema.nullable(),
    healthScore: z.coerce.number().min(0).max(100).nullable(),
    healthNote: z.string().max(1000).nullable(),
  })
  .partial();
export type UpdateChannelHealthRequest = z.infer<typeof updateChannelHealthSchema>;

/** Filter list kênh (CH-001: nền tảng/trạng thái/manager/niche/q; risk = chỉ kênh rủi ro/đi xuống). */
export const listChannelsQuerySchema = z.object({
  platform: channelPlatformSchema.optional(),
  status: channelStatusSchema.optional(),
  managerId: z.string().uuid().optional(),
  niche: z.string().max(120).optional(),
  q: z.string().max(200).optional(),
  risk: z.coerce.boolean().optional(),
});
export type ListChannelsQuery = z.infer<typeof listChannelsQuerySchema>;

export const channelRoleSchema = z.enum([
  "channel_manager",
  "seo",
  "uploader",
  "content_lead",
  "production_lead",
  "finance_viewer",
  "qa",
]);
export type ChannelRole = z.infer<typeof channelRoleSchema>;

export const channelMemberSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  channelId: z.string().uuid(),
  userId: z.string().uuid(),
  roleInChannel: channelRoleSchema.nullable(),
  permissionLevel: z.string().nullable(),
  status: z.enum(["active", "inactive"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ChannelMemberDto = z.infer<typeof channelMemberSchema>;

export const addChannelMemberSchema = z.object({
  userId: z.string().uuid(),
  roleInChannel: channelRoleSchema.optional(),
  permissionLevel: z.string().max(40).optional(),
});
export type AddChannelMemberRequest = z.infer<typeof addChannelMemberSchema>;

export const updateChannelMemberSchema = z
  .object({
    roleInChannel: channelRoleSchema,
    permissionLevel: z.string().max(40).nullable(),
    status: z.enum(["active", "inactive"]),
  })
  .partial();
export type UpdateChannelMemberRequest = z.infer<typeof updateChannelMemberSchema>;

export const projectStatusSchema = z.enum(["active", "paused", "archived"]);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

/** Loại dự án (PRJ-002) — khớp CHECK `projects_type_check` (0023). */
export const projectTypeSchema = z.enum([
  "content_production",
  "channel_operation",
  "growth_campaign",
  "recruitment",
  "training",
  "finance",
  "office_internal",
  "equipment",
]);
export type ProjectType = z.infer<typeof projectTypeSchema>;

export const projectPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export type ProjectPriority = z.infer<typeof projectPrioritySchema>;

/** Kênh gán vào project (light — dùng cho list + detail). */
export const projectChannelLinkSchema = z.object({
  id: z.string().uuid(),
  channelId: z.string().uuid(),
  name: z.string(),
  platform: channelPlatformSchema,
  roleInProject: z.string().nullable(),
  status: z.enum(["active", "inactive"]),
});
export type ProjectChannelLinkDto = z.infer<typeof projectChannelLinkSchema>;

/** Team gán vào project. */
export const projectTeamLinkSchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  name: z.string(),
  roleInProject: z.string().nullable(),
});
export type ProjectTeamLinkDto = z.infer<typeof projectTeamLinkSchema>;

export const projectMemberSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
  roleInProject: z.string().nullable(),
  permissionLevel: z.string().nullable(),
  /** numeric(5,2) — Drizzle trả string. */
  workloadPercent: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  status: z.enum(["active", "inactive"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProjectMemberDto = z.infer<typeof projectMemberSchema>;

export const projectSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  orgUnitId: z.string().uuid().nullable(),
  name: z.string(),
  code: z.string().nullable(),
  projectType: projectTypeSchema.nullable(),
  description: z.string().nullable(),
  ownerUserId: z.string().uuid().nullable(),
  projectManagerId: z.string().uuid().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  priority: projectPrioritySchema.nullable(),
  /** numeric(18,2) — Drizzle trả string. */
  budget: z.string().nullable(),
  status: projectStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  /** Populated khi list/detail. */
  channels: z.array(projectChannelLinkSchema).optional(),
  teams: z.array(projectTeamLinkSchema).optional(),
  members: z.array(projectMemberSchema).optional(),
});
export type ProjectDto = z.infer<typeof projectSchema>;

export const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().max(80).optional(),
  projectType: projectTypeSchema.optional(),
  description: z.string().max(2000).optional(),
  orgUnitId: z.string().uuid().optional(),
  ownerUserId: z.string().uuid().optional(),
  projectManagerId: z.string().uuid().optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  priority: projectPrioritySchema.optional(),
  budget: z.coerce.number().nonnegative().max(1_000_000_000_000).optional(),
});
export type CreateProjectRequest = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    name: z.string().min(1).max(200),
    code: z.string().max(80).nullable(),
    projectType: projectTypeSchema.nullable(),
    description: z.string().max(2000).nullable(),
    orgUnitId: z.string().uuid().nullable(),
    ownerUserId: z.string().uuid().nullable(),
    projectManagerId: z.string().uuid().nullable(),
    startDate: z.string().date().nullable(),
    endDate: z.string().date().nullable(),
    priority: projectPrioritySchema.nullable(),
    budget: z.coerce.number().nonnegative().max(1_000_000_000_000).nullable(),
    status: projectStatusSchema,
  })
  .partial();
export type UpdateProjectRequest = z.infer<typeof updateProjectSchema>;

/** Filter list dự án (PRJ-001: trạng thái/loại/độ ưu tiên/PM/q). */
export const listProjectsQuerySchema = z.object({
  status: projectStatusSchema.optional(),
  projectType: projectTypeSchema.optional(),
  priority: projectPrioritySchema.optional(),
  managerId: z.string().uuid().optional(),
  q: z.string().max(200).optional(),
});
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;

// ── Content types (catalog per-tenant, G6-4) ────────────────────────────────
export const contentTypeStatusSchema = z.enum(["active", "inactive"]);
export type ContentTypeStatus = z.infer<typeof contentTypeStatusSchema>;

/**
 * Content type (0024). `contentTypeSchema` ĐÃ ĐỔI từ enum (video/short/reel) → object —
 * breaking change G6-4b (content_type text → content_type_id FK).
 */
export const contentTypeSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  name: z.string(),
  code: z.string().nullable(),
  description: z.string().nullable(),
  /** uuid trần (KHÔNG FK ở M2; defer G7/G8). */
  defaultWorkflowTemplateId: z.string().uuid().nullable(),
  defaultEvaluationTemplateId: z.string().uuid().nullable(),
  targetPlatform: z.string().nullable(),
  /** integer — Drizzle trả number. */
  standardDuration: z.number().int().nullable(),
  status: contentTypeStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ContentTypeDto = z.infer<typeof contentTypeSchema>;

export const createContentTypeSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().max(80).optional(),
  description: z.string().max(2000).optional(),
  defaultWorkflowTemplateId: z.string().uuid().optional(),
  defaultEvaluationTemplateId: z.string().uuid().optional(),
  targetPlatform: z.string().max(80).optional(),
  standardDuration: z.coerce.number().int().min(0).max(100000).optional(),
});
export type CreateContentTypeRequest = z.infer<typeof createContentTypeSchema>;

export const updateContentTypeSchema = z
  .object({
    name: z.string().min(1).max(200),
    code: z.string().max(80).nullable(),
    description: z.string().max(2000).nullable(),
    defaultWorkflowTemplateId: z.string().uuid().nullable(),
    defaultEvaluationTemplateId: z.string().uuid().nullable(),
    targetPlatform: z.string().max(80).nullable(),
    standardDuration: z.coerce.number().int().min(0).max(100000).nullable(),
    status: contentTypeStatusSchema,
  })
  .partial();
export type UpdateContentTypeRequest = z.infer<typeof updateContentTypeSchema>;

// ── Content items (ERD-full, G6-4) ──────────────────────────────────────────
/** Workflow-lite status (0007, GIỮ NGUYÊN). */
export const contentStatusSchema = z.enum(["draft", "in_production", "review", "approved", "published"]);
export type ContentStatus = z.infer<typeof contentStatusSchema>;

/** Production status (10-value, TÁCH khỏi status) — khớp content_items_production_status_check (0025). */
export const productionStatusSchema = z.enum([
  "idea",
  "planning",
  "in_production",
  "waiting_review",
  "revision",
  "approved",
  "scheduled",
  "published",
  "analyzed",
  "cancelled",
]);
export type ProductionStatus = z.infer<typeof productionStatusSchema>;

export const contentPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export type ContentPriority = z.infer<typeof contentPrioritySchema>;

export const contentItemSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string(),
  contentTypeId: z.string().uuid().nullable(),
  code: z.string().nullable(),
  description: z.string().nullable(),
  ownerUserId: z.string().uuid().nullable(),
  mainChannelId: z.string().uuid().nullable(),
  language: z.string().nullable(),
  status: contentStatusSchema,
  productionStatus: productionStatusSchema.nullable(),
  plannedPublishAt: z.string().datetime().nullable(),
  publishedAt: z.string().datetime().nullable(),
  finalUrl: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  scriptUrl: z.string().nullable(),
  videoFileUrl: z.string().nullable(),
  priority: contentPrioritySchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ContentItemDto = z.infer<typeof contentItemSchema>;

export const createContentItemSchema = z.object({
  title: z.string().min(1).max(300),
  contentTypeId: z.string().uuid().optional(),
});
export type CreateContentItemRequest = z.infer<typeof createContentItemSchema>;

// ── Project ↔ channel / team / member links (G6-3) ──────────────────────────

export const addProjectChannelSchema = z.object({
  channelId: z.string().uuid(),
  roleInProject: z.string().max(120).optional(),
});
export type AddProjectChannelRequest = z.infer<typeof addProjectChannelSchema>;

export const updateProjectChannelSchema = z
  .object({
    roleInProject: z.string().max(120).nullable(),
    status: z.enum(["active", "inactive"]),
  })
  .partial();
export type UpdateProjectChannelRequest = z.infer<typeof updateProjectChannelSchema>;

export const addProjectTeamSchema = z.object({
  teamId: z.string().uuid(),
  roleInProject: z.string().max(120).optional(),
});
export type AddProjectTeamRequest = z.infer<typeof addProjectTeamSchema>;

export const addProjectMemberSchema = z.object({
  userId: z.string().uuid(),
  roleInProject: z.string().max(120).optional(),
  permissionLevel: z.string().max(40).optional(),
  workloadPercent: z.coerce.number().min(0).max(100).optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
});
export type AddProjectMemberRequest = z.infer<typeof addProjectMemberSchema>;

export const updateProjectMemberSchema = z
  .object({
    roleInProject: z.string().max(120).nullable(),
    permissionLevel: z.string().max(40).nullable(),
    workloadPercent: z.coerce.number().min(0).max(100).nullable(),
    startDate: z.string().date().nullable(),
    endDate: z.string().date().nullable(),
    status: z.enum(["active", "inactive"]),
  })
  .partial();
export type UpdateProjectMemberRequest = z.infer<typeof updateProjectMemberSchema>;
