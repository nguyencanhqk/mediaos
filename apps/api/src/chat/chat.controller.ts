import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { ChatService } from "./chat.service";
import { CreateChatRoomDto, SendMessageDto } from "./chat.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

@Controller("chat")
@UsePipes(ZodValidationPipe)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /** GET /chat/rooms — danh sách phòng chat của user */
  @Get("rooms")
  listRooms(@Req() req: AuthenticatedRequest) {
    return this.chat.listRooms(req.user.companyId, req.user.id);
  }

  /** POST /chat/rooms — tạo phòng chat thủ công */
  @Post("rooms")
  createRoom(@Req() req: AuthenticatedRequest, @Body() dto: CreateChatRoomDto) {
    return this.chat.createRoom(req.user.companyId, req.user.id, {
      name: dto.name,
      roomType: dto.roomType,
      refId: dto.refId ?? null,
    });
  }

  /** GET /chat/rooms/:roomId/messages — lấy tin nhắn */
  @Get("rooms/:roomId/messages")
  getMessages(@Req() req: AuthenticatedRequest, @Param("roomId") roomId: string) {
    return this.chat.getMessages(req.user.companyId, roomId, req.user.id);
  }

  /** POST /chat/rooms/:roomId/messages — gửi tin nhắn */
  @Post("rooms/:roomId/messages")
  sendMessage(
    @Req() req: AuthenticatedRequest,
    @Param("roomId") roomId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chat.sendMessage(req.user.companyId, roomId, req.user.id, dto.body);
  }
}
