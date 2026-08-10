import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ChatModule } from "../chat/chat.module";
import { PermissionModule } from "../permission/permission.module";
import { RealtimeEmitterModule } from "./realtime-emitter.module";
import { ChatPresenceReaderModule } from "./chat-presence-reader.module";
import { ChatPresenceService } from "./chat-presence.service";
import { RealtimeGateway } from "./realtime.gateway";
import { CallSignallingGateway } from "./call-signalling.gateway";
import { ChatCallCooldownService } from "../chat/chat-call-cooldown.service";

/**
 * RealtimeModule (G10-1) — wire WebSocket gateway namespace `/ws`.
 *
 * Phụ thuộc (đồ thị ACYCLIC):
 *  - AuthModule          → TokenService (verify JWT ở handshake; KHÔNG dùng guard cho WS).
 *  - RealtimeEmitterModule (module lá) → RealtimeEmitterService (cổng emit notification:new tới user-room).
 *  - ChatModule            → ChatRoomsRepository (S7-CHAT-RT-1: tra danh sách phòng lúc handshake).
 *  - PermissionModule      → PermissionService (cổng quyền `view:chat-room` trước khi join phòng chat)
 *                            + ValkeyService (S8-CHAT-UX-RT-1: kho trạng thái "đang online").
 *
 * ⚠️ Cạnh `RealtimeModule → ChatModule` chỉ đi MỘT HƯỚNG. Chiều ngược lại (`chat/**` cần emit) đi qua
 * `RealtimeEmitterModule` — module LÁ tách riêng đúng để phá vòng `Realtime → Chat → Realtime`. CẤM
 * bất kỳ file nào trong `apps/api/src/chat/` import `realtime.gateway`/`realtime.module`.
 *
 * KHÔNG export gì: gateway là điểm cuối, không service nào khác inject RealtimeGateway.
 */
@Module({
  imports: [
    AuthModule,
    RealtimeEmitterModule,
    // S8-CHAT-UX-FE-3 — leaf giữ vế CHỈ ĐỌC + định dạng khoá presence; `ChatModule` cũng import leaf này
    // (roster cần ảnh chụp), nhờ vậy hai vế đọc/ghi dùng CHUNG một không gian khoá mà không có vòng.
    ChatPresenceReaderModule,
    ChatModule,
    PermissionModule,
  ],
  // `ChatPresenceService` sống ở RealtimeModule (KHÔNG ở ChatModule): nó được lái bởi vòng đời kết nối WS,
  // và đặt nó trong `chat/**` sẽ buộc file đó import ngược `realtime.gateway` — đúng cạnh mà ratchet
  // `chat-realtime-structure.spec.ts` cấm (vòng Realtime→Chat→Realtime).
  // S7-CALL-RT-1 (additive): gateway `/ws-call`. Không export — gateway là điểm cuối.
  //
  // ⚠️ Nó nhận `ChatCallSignalService` (CHỈ ĐỌC, `ChatModule` export) chứ KHÔNG nhận
  // `ChatCallsRepository`: repo mang toàn bộ bề mặt GHI vòng đời cuộc gọi, và `chat.module.ts` cố ý
  // không export 4 provider CALL — đưa chúng ra khỏi module là đưa đường ghi ra khỏi `PermissionGuard`
  // + audit, tức phá hàng rào R4 của `DECISIONS-07`.
  providers: [
    RealtimeGateway,
    ChatPresenceService,
    CallSignallingGateway,
    // S7-CALL-RT-1: instance RIÊNG của bộ đếm cooldown — đúng như `chat.module.ts` đã chỉ định cho
    // trường hợp này ("module khác cần cooldown tự dựng instance của nó"). Hai instance KHÔNG chồng
    // hạn mức lên nhau: mỗi bên dùng `scope` riêng (`call-signal-*` vs `ice-config`/`call-invite`), và
    // khi có Valkey thì bộ đếm nằm ở Valkey nên vẫn là MỘT sổ cho cả cụm.
    ChatCallCooldownService,
  ],
})
export class RealtimeModule {}
