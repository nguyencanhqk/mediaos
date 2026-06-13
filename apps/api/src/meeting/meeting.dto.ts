import { createZodDto } from "nestjs-zod";
import {
  createMeetingSchema,
  updateMeetingSchema,
  createMeetingRoomSchema,
} from "@mediaos/contracts";

export class CreateMeetingDto extends createZodDto(createMeetingSchema) {}
export class UpdateMeetingDto extends createZodDto(updateMeetingSchema) {}
export class CreateMeetingRoomDto extends createZodDto(createMeetingRoomSchema) {}
