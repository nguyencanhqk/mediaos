import { z } from "zod";

export const channelPlatformSchema = z.enum(["youtube", "tiktok", "facebook", "instagram"]);
export type ChannelPlatform = z.infer<typeof channelPlatformSchema>;

export const channelSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  name: z.string(),
  platform: channelPlatformSchema,
  status: z.enum(["active", "inactive"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ChannelDto = z.infer<typeof channelSchema>;

export const createChannelSchema = z.object({
  name: z.string().min(1).max(200),
  platform: channelPlatformSchema,
});
export type CreateChannelRequest = z.infer<typeof createChannelSchema>;

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
