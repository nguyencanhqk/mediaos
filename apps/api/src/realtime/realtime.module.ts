import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ChatModule } from "../chat/chat.module";
import { PermissionModule } from "../permission/permission.module";
import { RealtimeEmitterModule } from "./realtime-emitter.module";
import { RealtimeGateway } from "./realtime.gateway";

/**
 * RealtimeModule (G10-1) — wire WebSocket gateway namespace `/ws`.
 *
 * Phụ thuộc (đồ thị ACYCLIC):
 *  - AuthModule          → TokenService (verify JWT ở handshake; KHÔNG dùng guard cho WS).
 *  - RealtimeEmitterModule (module lá) → RealtimeEmitterService (cổng emit notification:new tới user-room).
 *  - ChatModule            → ChatRoomsRepository (S7-CHAT-RT-1: tra danh sách phòng lúc handshake).
 *  - PermissionModule      → PermissionService (cổng quyền `view:chat-room` trước khi join phòng chat).
 *
 * ⚠️ Cạnh `RealtimeModule → ChatModule` chỉ đi MỘT HƯỚNG. Chiều ngược lại (`chat/**` cần emit) đi qua
 * `RealtimeEmitterModule` — module LÁ tách riêng đúng để phá vòng `Realtime → Chat → Realtime`. CẤM
 * bất kỳ file nào trong `apps/api/src/chat/` import `realtime.gateway`/`realtime.module`.
 *
 * KHÔNG export gì: gateway là điểm cuối, không service nào khác inject RealtimeGateway.
 */
@Module({
  imports: [AuthModule, RealtimeEmitterModule, ChatModule, PermissionModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
