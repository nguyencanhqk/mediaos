import {
  addChannelMemberSchema,
  addProjectChannelSchema,
  addProjectMemberSchema,
  addProjectTeamSchema,
  createChannelSchema,
  createContentItemSchema,
  createProjectSchema,
  updateChannelMemberSchema,
  updateChannelSchema,
  updateProjectChannelSchema,
  updateProjectMemberSchema,
  updateProjectSchema,
} from "@mediaos/contracts";
import { createZodDto } from "nestjs-zod";

export class CreateChannelDto extends createZodDto(createChannelSchema) {}
export class UpdateChannelDto extends createZodDto(updateChannelSchema) {}
export class AddChannelMemberDto extends createZodDto(addChannelMemberSchema) {}
export class UpdateChannelMemberDto extends createZodDto(updateChannelMemberSchema) {}
export class CreateProjectDto extends createZodDto(createProjectSchema) {}
export class UpdateProjectDto extends createZodDto(updateProjectSchema) {}
export class CreateContentItemDto extends createZodDto(createContentItemSchema) {}
export class AddProjectChannelDto extends createZodDto(addProjectChannelSchema) {}
export class UpdateProjectChannelDto extends createZodDto(updateProjectChannelSchema) {}
export class AddProjectTeamDto extends createZodDto(addProjectTeamSchema) {}
export class AddProjectMemberDto extends createZodDto(addProjectMemberSchema) {}
export class UpdateProjectMemberDto extends createZodDto(updateProjectMemberSchema) {}
