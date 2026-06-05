import {
  addProjectChannelSchema,
  createChannelSchema,
  createContentItemSchema,
  createProjectSchema,
} from "@mediaos/contracts";
import { createZodDto } from "nestjs-zod";

export class CreateChannelDto extends createZodDto(createChannelSchema) {}
export class CreateProjectDto extends createZodDto(createProjectSchema) {}
export class CreateContentItemDto extends createZodDto(createContentItemSchema) {}
export class AddProjectChannelDto extends createZodDto(addProjectChannelSchema) {}
