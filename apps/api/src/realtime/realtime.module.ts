import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ChatModule } from "../chat/chat.module";
import { RealtimeEmitterModule } from "./realtime-emitter.module";
import { RealtimeGateway } from "./realtime.gateway";

/**
 * RealtimeModule (G10-1) — wire WebSocket gateway namespace `/ws`.
 *
 * Phụ thuộc (đồ thị ACYCLIC):
 *  - AuthModule          → TokenService (verify JWT ở handshake; KHÔNG dùng guard cho WS).
 *  - ChatModule          → ChatService (membership check + sendMessage masked DTO).
 *  - RealtimeEmitterModule (module lá) → RealtimeEmitterService (cổng emit chung; ChatService cũng import
 *    module lá này để emit chat:message ⇒ KHÔNG tạo cycle Realtime→Chat→Realtime).
 *
 * KHÔNG export gì: gateway là điểm cuối, không service nào khác inject RealtimeGateway.
 */
@Module({
  imports: [AuthModule, ChatModule, RealtimeEmitterModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
