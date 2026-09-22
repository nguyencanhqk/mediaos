import { Module, type OnModuleInit } from "@nestjs/common";
import { FilePolicyService } from "../foundation/files/file-policy.service";
import { FilesModule } from "../foundation/files/files.module";
import { PermissionModule } from "../permission/permission.module";
import { RealtimeEmitterModule } from "../realtime/realtime-emitter.module";
import { StorageModule } from "../storage/storage.module";
import { SocialAccessService } from "./social-access.service";
import { SocialAttachmentsService } from "./social-attachments.service";
import { SocialCommentsRepository } from "./social-comments.repository";
import { SocialCommentsService } from "./social-comments.service";
import { SocialDiscoveryRepository } from "./social-discovery.repository";
import { SocialDiscoveryService } from "./social-discovery.service";
import { SocialFileResolver } from "./social-file.resolver";
import { SocialNewsRepository } from "./social-news.repository";
import { SocialNewsService } from "./social-news.service";
import { SocialPostsModerationService } from "./social-posts-moderation.service";
import { SocialActorProjectionRepository, SocialPostsRepository } from "./social-posts.repository";
import { SocialPostsService } from "./social-posts.service";
import { SocialReactionsRepository } from "./social-reactions.repository";
import { SocialReactionsService } from "./social-reactions.service";
import { SocialReportsRepository } from "./social-reports.repository";
import { SocialReportsService } from "./social-reports.service";
import {
  SocialDiscoveryController,
  SocialNewsController,
  SocialReportsController,
} from "./social-b.controllers";
import {
  SocialCommentsController,
  SocialPostsController,
  SocialReactionsController,
} from "./social.controllers";

/**
 * S16-SOCIAL-BE-1 — `SocialModule` (SPEC-16 · DB-17 · API-19), 19 route Nhóm A.
 *
 * imports: `PermissionModule` (PermissionGuard + DataScopeService — guard 2 tầng §11) ·
 * `FilesModule` (FilePolicyService — đăng ký resolver đính kèm) · **`RealtimeEmitterModule`**
 * (module LÁ, chỉ cấp `RealtimeEmitterService` — KHÔNG `RealtimeModule`, vốn kéo cả gateway +
 * `ChatRoomsRepository` và làm Nest sập lúc bootstrap). `AuditService` + `OutboxService` đến từ
 * `EventsModule` `@Global`.
 *
 * ⚠️ `StorageModule` phải khai RIÊNG: `FilesModule` chỉ IMPORT nó, KHÔNG re-export `STORAGE_ADAPTER`
 * (cùng ghi chú đã có ở `chat.module.ts:100`). Thiếu nó ⇒ Nest không resolve được
 * `SocialAttachmentsService` và **sập lúc bootstrap**, kéo đỏ dây chuyền mọi int-spec.
 *
 * ⚠️ **KHÔNG trộn với `apps/api/src/integrations/social/`** (app vệ tinh fbpost, SOC-DEC-002). Hai
 * thứ trùng tên nhưng khác hẳn: fbpost là cầu SSO ở segment `integrations/**` (tag OpenAPI `FND`),
 * module này là bảng tin nội bộ ở segment `social/**` (tag `SOCIAL`).
 *
 * ⚠️ **NOTI: registrar sống ở `notifications/**`**, KHÔNG ở đây (tiền lệ GOAL/ASSET/RECRUIT/CHAT —
 * 12 registrar đều nằm bên đó). Plan §6 viết `SocialModule.onModuleInit()` gọi `registerSource`, và
 * làm vậy sẽ buộc `SocialModule` import `NotificationsModule` — chiều ngược với mọi module khác và
 * tạo vòng phụ thuộc. Module này KHÔNG import `NotificationsModule` và ngược lại.
 *
 * Module `SOCIAL` vẫn `is_active = false` trong catalog — `S16-SOCIAL-FE-1` mới bật cờ, nên route
 * sống nhưng chưa lộ ra FE.
 */
@Module({
  imports: [PermissionModule, FilesModule, RealtimeEmitterModule, StorageModule],
  controllers: [
    SocialPostsController,
    SocialReactionsController,
    SocialCommentsController,
    // S16-SOCIAL-BE-1B — khối additive, KHÔNG viết lại mảng cũ (hot-file: append, không rewrite).
    SocialNewsController,
    SocialDiscoveryController,
    SocialReportsController,
  ],
  providers: [
    SocialAccessService,
    SocialPostsRepository,
    SocialActorProjectionRepository,
    SocialCommentsRepository,
    SocialReactionsRepository,
    SocialAttachmentsService,
    SocialPostsService,
    SocialPostsModerationService,
    SocialCommentsService,
    SocialReactionsService,
    SocialFileResolver,
    // S16-SOCIAL-BE-1B — khối additive.
    SocialNewsRepository,
    SocialNewsService,
    SocialDiscoveryRepository,
    SocialDiscoveryService,
    SocialReportsRepository,
    SocialReportsService,
  ],
  exports: [SocialAccessService],
})
export class SocialModule implements OnModuleInit {
  constructor(
    private readonly filePolicy: FilePolicyService,
    private readonly fileResolver: SocialFileResolver,
  ) {}

  /**
   * Đăng ký resolver quyền tệp cho cặp `(SOCIAL, feed_post)` và `(SOCIAL, feed_comment)`.
   *
   * ⚠️ **BẮT BUỘC, không phải tuỳ chọn.** `FilePolicyService.decideForLinkedFile` DENY
   * `deny-no-resolver` khi một link có cặp chưa ai đăng ký, và nó KHÔNG leo thang lên
   * `FOUNDATION.FILE.*`. Thiếu dòng này thì: (a) mọi đính kèm SOCIAL không ký được URL, và (b) vì
   * luật là AND trên MỌI link của một tệp, gắn tệp vào bài sẽ làm tệp đó **không tải được ở mọi
   * module khác** — tức thiếu nó làm hỏng tệp của module khác, không chỉ của SOCIAL.
   */
  onModuleInit(): void {
    this.filePolicy.registerResolver(this.fileResolver);
  }
}
