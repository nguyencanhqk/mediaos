import { Module } from "@nestjs/common";
import { SocialGroupRoomsReader } from "./social-group-rooms.reader";

/**
 * S16-SOCIAL-BE-2C — module LÁ cấp `SocialGroupRoomsReader` cho `RealtimeModule` (gateway `/ws` liệt kê
 * nhóm của user lúc connect).
 *
 * **0 import** có chủ ý: `DatabaseService` là `@Global` (plan M13). Cạnh `RealtimeModule → module này`
 * thay cho `RealtimeModule → SocialModule`: `SocialModule` import `RealtimeEmitterModule`, kéo thêm cả
 * đồ thị SOCIAL (permission · files · storage …) vào injector của gateway là đúng lớp việc đã từng làm
 * Nest sập lúc bootstrap (docblock `social.module.ts`). Ratchet `feed-realtime-structure.spec.ts` (S2)
 * khoá tính chất lá của file này.
 */
@Module({
  providers: [SocialGroupRoomsReader],
  exports: [SocialGroupRoomsReader],
})
export class SocialGroupRoomsModule {}
