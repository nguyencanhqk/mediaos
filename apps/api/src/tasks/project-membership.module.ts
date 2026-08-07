import { Module } from "@nestjs/common";
import { ProjectMembershipService } from "./project-membership.service";

/**
 * S8-CHAT-UX-BE-2 — **MODULE LÁ**: `imports: []`, đúng 1 provider thuần-truy-vấn.
 *
 * Lý do tồn tại (đầy đủ ở jsdoc `ProjectMembershipService`): `TasksModule` đã import `ChatModule`, nên
 * `ChatModule → TasksModule` là vòng. Module này là điểm chung cả hai bên import được mà không tạo cạnh
 * giữa chúng — cùng khuôn `RealtimeEmitterModule` (tách ra để phá `Realtime → Chat → Realtime`).
 *
 * ⚠️ **GIỮ NÓ LÀ LÁ.** Thêm bất kỳ `imports:` nào vào đây là mở lại đúng lớp vòng mà nó sinh ra để phá.
 * Provider ở đây chỉ được nhận `tx` từ caller — KHÔNG inject `DatabaseService`, KHÔNG tự mở `withTenant`.
 */
@Module({
  providers: [ProjectMembershipService],
  exports: [ProjectMembershipService],
})
export class ProjectMembershipModule {}
