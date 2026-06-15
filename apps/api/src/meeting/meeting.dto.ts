import { createZodDto } from "nestjs-zod";
import {
  createMeetingSchema,
  updateMeetingSchema,
  createMeetingRoomSchema,
  createMeetingNoteSchema,
  updateMeetingNoteSchema,
  createMeetingActionSchema,
} from "@mediaos/contracts";

export class CreateMeetingDto extends createZodDto(createMeetingSchema) {}
export class UpdateMeetingDto extends createZodDto(updateMeetingSchema) {}
export class CreateMeetingRoomDto extends createZodDto(createMeetingRoomSchema) {}
export class CreateMeetingNoteDto extends createZodDto(createMeetingNoteSchema) {}
export class UpdateMeetingNoteDto extends createZodDto(updateMeetingNoteSchema) {}
export class CreateMeetingActionDto extends createZodDto(createMeetingActionSchema) {}
