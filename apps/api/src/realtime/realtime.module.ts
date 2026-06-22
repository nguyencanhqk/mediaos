import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RealtimeEmitterModule } from "./realtime-emitter.module";
import { RealtimeGateway } from "./realtime.gateway";

/**
 * RealtimeModule (G10-1) — wire WebSocket gateway namespace `/ws`.
 *
 * Phụ thuộc (đồ thị ACYCLIC):
 *  - AuthModule          → TokenService (verify JWT ở handshake; KHÔNG dùng guard cho WS).
 *  - RealtimeEmitterModule (module lá) → RealtimeEmitterService (cổng emit notification:new tới user-room).
 *
 * (CLEAN-DECOUPLE-1 de-media-fy: gỡ ChatModule — cụm chat out-of-scope; gateway chỉ còn đường NOTI push.)
 * KHÔNG export gì: gateway là điểm cuối, không service nào khác inject RealtimeGateway.
 */
@Module({
  imports: [AuthModule, RealtimeEmitterModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
