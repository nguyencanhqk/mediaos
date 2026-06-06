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

/** Filter list kênh (CH-001: nền tảng/trạng thái/manager/niche/q). */
export const listChannelsQuerySchema = z.object({
  platform: channelPlatformSchema.optional(),
  status: channelStatusSchema.optional(),
  managerId: z.string().uuid().optional(),
  niche: z.string().max(120).optional(),
  q: z.string().max(200).optional(),
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

export const contentTypeSchema = z.enum(["video", "short", "reel"]);
export const contentStatusSchema = z.enum(["draft", "in_production", "review", "approved", "published"]);

export const contentItemSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string(),
  contentType: contentTypeSchema,
  status: contentStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ContentItemDto = z.infer<typeof contentItemSchema>;

export const createContentItemSchema = z.object({
  title: z.string().min(1).max(300),
  contentType: contentTypeSchema.default("video"),
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
