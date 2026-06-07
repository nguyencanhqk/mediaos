import {
  addChannelMemberSchema,
  addContentChannelSchema,
  addProjectChannelSchema,
  addProjectMemberSchema,
  addProjectTeamSchema,
  createChannelSchema,
  createContentAssetSchema,
  createContentAssetVersionSchema,
  createContentItemSchema,
  createContentTypeSchema,
  createProjectSchema,
  listContentQuerySchema,
  updateChannelHealthSchema,
  updateChannelMemberSchema,
  updateChannelSchema,
  updateContentChannelSchema,
  updateContentItemSchema,
  updateContentTypeSchema,
  updateProjectChannelSchema,
  updateProjectMemberSchema,
  updateProjectSchema,
} from "@mediaos/contracts";
import { createZodDto } from "nestjs-zod";

export class CreateChannelDto extends createZodDto(createChannelSchema) {}
export class UpdateChannelDto extends createZodDto(updateChannelSchema) {}
export class UpdateChannelHealthDto extends createZodDto(updateChannelHealthSchema) {}
export class AddChannelMemberDto extends createZodDto(addChannelMemberSchema) {}
export class UpdateChannelMemberDto extends createZodDto(updateChannelMemberSchema) {}
export class CreateProjectDto extends createZodDto(createProjectSchema) {}
export class UpdateProjectDto extends createZodDto(updateProjectSchema) {}
export class AddProjectChannelDto extends createZodDto(addProjectChannelSchema) {}
export class UpdateProjectChannelDto extends createZodDto(updateProjectChannelSchema) {}
export class AddProjectTeamDto extends createZodDto(addProjectTeamSchema) {}
export class AddProjectMemberDto extends createZodDto(addProjectMemberSchema) {}
export class UpdateProjectMemberDto extends createZodDto(updateProjectMemberSchema) {}

// ── Content (G6-4) ──────────────────────────────────────────────────────────
export class ListContentQueryDto extends createZodDto(listContentQuerySchema) {}
export class CreateContentItemDto extends createZodDto(createContentItemSchema) {}
export class UpdateContentItemDto extends createZodDto(updateContentItemSchema) {}
export class CreateContentTypeDto extends createZodDto(createContentTypeSchema) {}
export class UpdateContentTypeDto extends createZodDto(updateContentTypeSchema) {}
export class AddContentChannelDto extends createZodDto(addContentChannelSchema) {}
export class UpdateContentChannelDto extends createZodDto(updateContentChannelSchema) {}
export class CreateContentAssetDto extends createZodDto(createContentAssetSchema) {}
export class CreateContentAssetVersionDto extends createZodDto(createContentAssetVersionSchema) {}
