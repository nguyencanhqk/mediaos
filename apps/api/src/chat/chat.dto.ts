import { createZodDto } from "nestjs-zod";
import { createChatRoomSchema, sendMessageSchema } from "@mediaos/contracts";

export class CreateChatRoomDto extends createZodDto(createChatRoomSchema) {}
export class SendMessageDto extends createZodDto(sendMessageSchema) {}
