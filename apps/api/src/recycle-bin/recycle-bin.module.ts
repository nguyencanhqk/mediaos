import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { PermissionModule } from "../permission/permission.module";
import { ChatModule } from "../chat/chat.module";
import { RecycleBinController } from "./recycle-bin.controller";
import { RecycleBinRepository } from "./recycle-bin.repository";
import { RecycleBinService } from "./recycle-bin.service";
import { RecycleBinFeedPostsController } from "./recycle-bin-feed-posts.controller";
import { RecycleBinRegistryModule } from "./recycle-bin-registry.module";

@Module({
  imports: [
    DatabaseModule,
    // PermissionModule exports the permission stack + guards.
    // AuditService is global (EventsModule @Global) — no explicit import needed.
    PermissionModule,
    // S7-CHAT-BE-5 (W13): khôi phục hồ sơ ⇒ người đó vào lại phòng dẫn xuất NGAY trong tx khôi phục.
    ChatModule,
    // S16-SOCIAL-BE-3C (D6) — khối additive: registry theo loại đối tượng (module LÁ). `SocialModule` import
    // CÙNG module này để tự đăng ký handler `feed_post` ⇒ một singleton, không cạnh RecycleBin ↔ Social.
    RecycleBinRegistryModule,
  ],
  controllers: [
    RecycleBinController,
    // S16-SOCIAL-BE-3C (D7) — khối additive: `057`/`058`. Lớp RIÊNG để file employee 0 diff và census 2 tầng
    // SOCIAL (allowlist theo TÊN lớp) không kéo route employee vào phép đo.
    RecycleBinFeedPostsController,
  ],
  providers: [RecycleBinService, RecycleBinRepository],
})
export class RecycleBinModule {}
