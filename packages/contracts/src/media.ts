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

export const projectSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  orgUnitId: z.string().uuid().nullable(),
  name: z.string(),
  status: projectStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  /** Populated khi list: danh sách kênh gán cho project. */
  channels: z.array(z.object({ id: z.string().uuid(), name: z.string(), platform: channelPlatformSchema })).optional(),
});
export type ProjectDto = z.infer<typeof projectSchema>;

export const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  orgUnitId: z.string().uuid().optional(),
});
export type CreateProjectRequest = z.infer<typeof createProjectSchema>;

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

export const addProjectChannelSchema = z.object({
  channelId: z.string().uuid(),
});
export type AddProjectChannelRequest = z.infer<typeof addProjectChannelSchema>;
