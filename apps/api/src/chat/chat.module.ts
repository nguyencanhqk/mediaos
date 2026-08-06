import { Module, type OnModuleInit } from "@nestjs/common";
import { PermissionModule } from "../permission/permission.module";
import { SequenceModule } from "../foundation/sequences/sequence.module";
import { FilesModule } from "../foundation/files/files.module";
import { FilePolicyService } from "../foundation/files/file-policy.service";
import { StorageModule } from "../storage/storage.module";
import { RealtimeEmitterModule } from "../realtime/realtime-emitter.module";
import { ChatRoomsController } from "./chat-rooms.controller";
import { ChatMessagesController } from "./chat-messages.controller";
import { ChatAccessService } from "./chat-access.service";
import { ChatRoomPrefsService } from "./chat-room-prefs.service";
import { ChatRoomsService } from "./chat-rooms.service";
import { ChatMembersService } from "./chat-members.service";
// S8-CHAT-UX-RT-1 (additive): "đang gõ" — REST-ping → fan-out WS, 0 ghi DB, 0 audit (CHAT-DEC-017).
import { ChatTypingService } from "./chat-typing.service";
import { ChatRoomsRepository } from "./chat-rooms.repository";
import { ChatRoomCodeService } from "./chat-room-code.service";
// S7-CHAT-BE-2 (additive): tin nhắn — đọc theo con trỏ · gửi idempotent · thu hồi · ghim · đã đọc.
import { ChatMessagesService } from "./chat-messages.service";
import { ChatMessageModerationService } from "./chat-message-moderation.service";
import { ChatMessagesRepository } from "./chat-messages.repository";
// S7-CHAT-BE-3 (additive): đính kèm qua FOUNDATION Files + resolver quyền riêng của CHAT.
import { ChatAttachmentsRepository } from "./chat-attachments.repository";
import { ChatAttachmentPresignService } from "./chat-attachments.service";
import { ChatMessageFileResolver } from "./chat-message-file.resolver";
// S7-CHAT-BE-4 (additive): tìm kiếm toàn văn — controller RIÊNG vì đây là ngoại lệ membership duy nhất
// của module (xem jsdoc `ChatSearchController`).
import { ChatSearchController } from "./chat-search.controller";
import { ChatSearchService } from "./chat-search.service";
import { ChatSearchRepository } from "./chat-search.repository";
// S7-CHAT-BE-5 (additive): phòng dẫn xuất theo phòng ban/dự án + job đối soát định kỳ.
import { ChatDerivedRoomsSyncService } from "./chat-derived-rooms-sync.service";
import { ChatDerivedRoomsReconcileJobHandler } from "./chat-derived-rooms-reconcile.job-handler";
// S7-CHAT-BE-7 🔒 (additive): ĐỌC-VƯỢT MEMBERSHIP — controller/service/repo RIÊNG, path `/chat/oversight/*`,
// cặp quyền RIÊNG `('view','chat-oversight')`. Xem cảnh báo ở jsdoc `@Module` bên dưới.
// S7-CHAT-BE-8 (additive): presign upload own-scope — controller RIÊNG (`/chat/files/*`), cặp
// `('send','chat-message')`. Không cặp quyền mới, không migration.
import { ChatFilesController } from "./chat-files.controller";
import { ChatFilesService } from "./chat-files.service";
import { ChatOversightController } from "./chat-oversight.controller";
import { ChatOversightAuditGuard } from "./chat-oversight-audit.guard";
import { ChatOversightService } from "./chat-oversight.service";
import { ChatOversightRepository } from "./chat-oversight.repository";

/**
 * S7-CHAT-BE-1 — `ChatModule` (SPEC-15 · DB-12 · API-13).
 *
 * imports:
 *   • `PermissionModule` — `PermissionGuard` cho 4 cặp quyền của WO này (`view/create/update/archive`
 *     × `chat-room`, `manage:chat-member`), seed ở mig `0538`;
 *   • `SequenceModule`   — cấp `room_code` (counter `chat_room`, prefix `ROOM-`, padding 4). KHÁC các
 *     module trước: `ChatRoomCodeService` CÓ lazy-create counter khi company chưa được `0538` seed —
 *     trả nợ FULL gate của `S7-CHAT-DB-1` (xem ghi chú trong file đó).
 * `AuditService` đến từ `EventsModule` (@Global) — ghi TRONG cùng tx nghiệp vụ.
 *
 * `ChatAccessService` được `exports` để `S7-CHAT-BE-2..6` (tin nhắn · tệp · tìm kiếm · phòng dẫn xuất ·
 * NOTI) và `S7-CHAT-RT-1` (WebSocket) dùng LẠI ĐÚNG hàm này. Ai import module rồi tự viết điều kiện
 * membership là dựng bản sao thứ hai của luật quyền — bản sao sẽ trôi.
 *
 * ⚠️ `S7-CHAT-BE-7` (đọc-vượt membership, CHAT-DEC-004) KHÔNG được thêm vào đây dưới dạng nhánh của
 * `ChatRoomsService`/`ChatRoomsController`: nó là service + controller RIÊNG, path `/chat/oversight/*`,
 * cặp quyền riêng `('view','chat-oversight')` (API-13 §5.3 ràng buộc 1). ĐÃ thi công — 4 provider +
 * 1 controller ở khối `S7-CHAT-BE-7` bên dưới.
 *
 * ⚠️ `ChatOversightService` và `ChatOversightRepository` **CỐ Ý KHÔNG `exports`**. Chúng là đường đọc
 * BỎ QUA ranh giới membership; lọt vào một module khác là một đường đọc toàn tenant KHÔNG DẤU VẾT (mọi
 * dòng audit chỉ được ghi vì `ChatOversightService` tự ghi trong cùng transaction). Mirror lý do
 * `ChatDerivedRoomsReconcileJobHandler` không export.
 */
@Module({
  // S7-CHAT-BE-3 (additive): `FilesModule` cấp `FilePolicyService` (CÙNG singleton — điều kiện để
  // `registerResolver` bên dưới có tác dụng) + `FileLinkRepository`/`FileAccessLogService` (CHAT tự ghi
  // link trong tx gửi tin, mẫu `HrEmployeeAvatarService`).
  //
  // ⚠️ `StorageModule` phải khai RIÊNG: `FilesModule` chỉ IMPORT nó, KHÔNG re-export `STORAGE_ADAPTER`.
  // Thiếu dòng này thì `ChatAttachmentPresignService` không resolve được và **AppModule sập lúc khởi
  // động** — kéo theo mọi int-spec đỏ dây chuyền, không chỉ CHAT (lớp `systemjobhandler-optional-dbw-di`).
  // S7-CHAT-RT-1 (additive): `RealtimeEmitterModule` là module LÁ — chỉ cấp `RealtimeEmitterService`.
  // CẤM đổi thành `RealtimeModule`: đó là vòng `Realtime → Chat → Realtime` mà module lá được tách ra
  // để phá (xem jsdoc `realtime-emitter.module.ts` + `realtime.module.ts`).
  imports: [PermissionModule, SequenceModule, FilesModule, StorageModule, RealtimeEmitterModule],
  controllers: [
    ChatRoomsController,
    ChatMessagesController,
    ChatSearchController,
    // S7-CHAT-BE-8 — `/chat/files/*`. Controller RIÊNG chứ không thêm route vào `ChatMessagesController`:
    // hai route này KHÔNG nhận `roomId` và KHÔNG đi qua `assertMember` (tệp chưa thuộc phòng nào), nên
    // đứng chung với các route luôn-assertMember sẽ làm mờ đúng tính chất đó — mirror lý do
    // `ChatSearchController` tách ra vì là ngoại lệ membership.
    ChatFilesController,
    ChatOversightController,
  ],
  providers: [
    ChatAccessService,
    ChatRoomsService,
    ChatMembersService,
    ChatRoomsRepository,
    ChatRoomCodeService,
    ChatMessagesService,
    ChatMessageModerationService,
    ChatMessagesRepository,
    // ── S7-CHAT-BE-3 ──
    ChatAttachmentsRepository,
    ChatAttachmentPresignService,
    ChatMessageFileResolver,
    // ── S7-CHAT-BE-4 ──
    ChatSearchService,
    ChatSearchRepository,
    // ── S7-CHAT-BE-5 ──
    ChatDerivedRoomsSyncService,
    ChatDerivedRoomsReconcileJobHandler,
    // ── S7-CHAT-BE-8 ── `FileService` + `FileRepository` đến từ `FilesModule` ĐÃ import ở trên (BE-3),
    // không thêm import nào. CỐ Ý KHÔNG export: đây là đường GHI bỏ qua gate `upload:foundation-file`,
    // module khác cần thì phải tự bọc bằng cặp quyền CỦA NÓ (mirror `ChatOversightService`).
    ChatFilesService,
    // ── S7-CHAT-BE-7 🔒 ── `ChatOversightAuditGuard` phải là PROVIDER (không `new` trong `@UseGuards`):
    // nó cần DI 4 thứ (`Reflector`, `PermissionService`, `DatabaseService`, `AuditService`). Khai dạng
    // lớp trong `@UseGuards` để Nest tự dựng qua container — mẫu `PermissionGuard`.
    ChatOversightAuditGuard,
    ChatOversightService,
    ChatOversightRepository,
    // ── S8-CHAT-UX-RT-1 ── CHAT-API-023. Đi qua `RealtimeEmitterModule` (module LÁ) đã import ở trên —
    // KHÔNG import `realtime.module`/`realtime.gateway` (ratchet `chat-realtime-structure.spec.ts`).
    // CỐ Ý KHÔNG export: lối vào duy nhất là route CHAT-API-023, đã gate bằng `send:chat-message`.
    ChatTypingService,
    // ── S8-CHAT-UX-BE-1 ── CHAT-API-024a/b · 025 · 020. Chỉ cần `DatabaseService` + `ChatAccessService`
    // + `ChatRoomsRepository` (đã ở trên). CỐ Ý KHÔNG export: ba tuỳ chọn này ghi lên hàng membership
    // CỦA CHÍNH actor — module khác gọi được là mở đường đặt tuỳ chọn hộ người khác.
    ChatRoomPrefsService,
  ],
  // `ChatDerivedRoomsSyncService` export cho 5 module writer (org · employees · tasks · recycle-bin).
  // Job handler CỐ Ý KHÔNG export: nó được SchedulerModule gom qua DiscoveryService bằng metadata, không
  // ai được phép inject và tự gọi `run()` ngoài nhịp scheduler (mirror `SystemJobRunsRetentionJobHandler`).
  exports: [
    ChatAccessService,
    ChatRoomsRepository,
    ChatMessagesRepository,
    ChatDerivedRoomsSyncService,
  ],
})
export class ChatModule implements OnModuleInit {
  constructor(
    private readonly filePolicy: FilePolicyService,
    private readonly messageFileResolver: ChatMessageFileResolver,
  ) {}

  /**
   * S7-CHAT-BE-3 — đăng ký `(CHAT, chat_message)` vào singleton `FilePolicyService` dùng chung
   * (mẫu `CompanyModule.onModuleInit` / `MeModule`).
   *
   * ⚠️ **BẮT BUỘC, không phải tối ưu.** `decideForLinkedFile` fail-closed `deny-no-resolver` cho MỌI link
   * chưa có resolver và **KHÔNG** escalate xuống fallback `FOUNDATION.FILE.*` ⇒ thiếu đúng một dòng này
   * thì tệp gửi được mà **không ai tải được**, kể cả người vừa gửi — tính năng chết trong im lặng (đúng
   * lỗi đã ship thật ở `S5-BRAND-BE-1`). Ca test số 1 của WO gỡ dòng này để chứng minh tính chất đó.
   *
   * Additive — KHÔNG đụng `app.module.ts`. `registerResolver` NÉM khi trùng key ⇒ đăng ký hai lần là sập
   * boot fail-loud, không ghi đè im lặng.
   */
  onModuleInit(): void {
    this.filePolicy.registerResolver(this.messageFileResolver);
  }
}
