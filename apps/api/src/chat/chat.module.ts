import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { ChatRepository } from "./chat.repository";
import { ChatService } from "./chat.service";
import { ChatController } from "./chat.controller";

@Module({
  imports: [DatabaseModule],
  controllers: [ChatController],
  providers: [ChatRepository, ChatService],
  exports: [ChatService],
})
export class ChatModule {}
