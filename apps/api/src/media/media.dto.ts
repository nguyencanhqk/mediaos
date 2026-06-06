import {
  addChannelMemberSchema,
  addProjectChannelSchema,
  createChannelSchema,
  createContentItemSchema,
  createProjectSchema,
  updateChannelMemberSchema,
  updateChannelSchema,
} from "@mediaos/contracts";
import { createZodDto } from "nestjs-zod";

export class CreateChannelDto extends createZodDto(createChannelSchema) {}
export class UpdateChannelDto extends createZodDto(updateChannelSchema) {}
export class AddChannelMemberDto extends createZodDto(addChannelMemberSchema) {}
export class UpdateChannelMemberDto extends createZodDto(updateChannelMemberSchema) {}
export class CreateProjectDto extends createZodDto(createProjectSchema) {}
export class CreateContentItemDto extends createZodDto(createContentItemSchema) {}
export class AddProjectChannelDto extends createZodDto(addProjectChannelSchema) {}
