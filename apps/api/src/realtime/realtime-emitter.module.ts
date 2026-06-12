import { Module } from "@nestjs/common";
import { RealtimeEmitterService } from "./realtime-emitter.service";

/**
 * Module LÁ (không phụ thuộc Chat/Notifications) chỉ cung cấp RealtimeEmitterService.
 *
 * Tách riêng để PHÁ vòng phụ thuộc: ChatModule + NotificationsModule cần emit (import module này),
 * còn RealtimeModule (gateway) cần ChatService. Nếu emitter nằm trong RealtimeModule sẽ tạo cycle
 * RealtimeModule → ChatModule → RealtimeModule. Để emitter ở module lá ⇒ đồ thị acyclic.
 */
@Module({
  providers: [RealtimeEmitterService],
  exports: [RealtimeEmitterService],
})
export class RealtimeEmitterModule {}
