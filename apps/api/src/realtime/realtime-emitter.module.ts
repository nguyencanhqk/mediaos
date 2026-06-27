import { Module } from "@nestjs/common";
import { RealtimeEmitterService } from "./realtime-emitter.service";

/**
 * Module LÁ (không phụ thuộc module nghiệp vụ) chỉ cung cấp RealtimeEmitterService.
 *
 * Tách riêng để NotificationsModule import cổng emit mà KHÔNG kéo theo RealtimeModule (gateway + AuthModule).
 * (de-media-fy CLEAN-BE-1: cụm chat đã gỡ — trước đây leaf này còn để phá cycle Realtime→Chat→Realtime;
 *  nay chỉ NotificationsModule dùng, giữ leaf cho nhẹ phụ thuộc.)
 */
@Module({
  providers: [RealtimeEmitterService],
  exports: [RealtimeEmitterService],
})
export class RealtimeEmitterModule {}
