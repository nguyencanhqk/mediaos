import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { RealtimeEmitterModule } from "../realtime/realtime-emitter.module";
import { ChatRepository } from "./chat.repository";
import { ChatService } from "./chat.service";
import { ChatController } from "./chat.controller";

@Module({
  // RealtimeEmitterModule = module lá (chỉ RealtimeEmitterService) → ChatService emit chat:message
  // mà KHÔNG tạo cycle (gateway ở RealtimeModule import ChatModule, không ngược lại).
  imports: [DatabaseModule, RealtimeEmitterModule],
  controllers: [ChatController],
  providers: [ChatRepository, ChatService],
  exports: [ChatService],
})
export class ChatModule {}
