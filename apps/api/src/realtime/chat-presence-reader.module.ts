import { Module } from "@nestjs/common";
import { PermissionModule } from "../permission/permission.module";
import { ChatPresenceReaderService } from "./chat-presence-reader.service";

/**
 * Module LÁ (S8-CHAT-UX-FE-3) — chỉ cung cấp `ChatPresenceReaderService`.
 *
 * Tách riêng để `ChatModule` đọc được trạng thái "đang online" mà **KHÔNG** kéo theo `RealtimeModule`
 * (gateway + `AuthModule` + chính `ChatModule`) — cạnh đó là một vòng, xem jsdoc của service.
 * Cùng khuôn với `RealtimeEmitterModule`.
 *
 * `PermissionModule` chỉ để lấy `ValkeyService` (nó export sẵn); `PermissionModule` nằm DƯỚI `ChatModule`
 * trong đồ thị (chính `ChatModule` đã import nó từ S7) nên cạnh này không tạo vòng mới.
 */
@Module({
  imports: [PermissionModule],
  providers: [ChatPresenceReaderService],
  exports: [ChatPresenceReaderService],
})
export class ChatPresenceReaderModule {}
