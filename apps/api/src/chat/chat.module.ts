import { Module } from "@nestjs/common";
import { PermissionModule } from "../permission/permission.module";
import { SequenceModule } from "../foundation/sequences/sequence.module";
import { ChatRoomsController } from "./chat-rooms.controller";
import { ChatAccessService } from "./chat-access.service";
import { ChatRoomsService } from "./chat-rooms.service";
import { ChatMembersService } from "./chat-members.service";
import { ChatRoomsRepository } from "./chat-rooms.repository";
import { ChatRoomCodeService } from "./chat-room-code.service";

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
 * cặp quyền riêng `('view','chat-oversight')` (API-13 §5.3 ràng buộc 1).
 */
@Module({
  imports: [PermissionModule, SequenceModule],
  controllers: [ChatRoomsController],
  providers: [
    ChatAccessService,
    ChatRoomsService,
    ChatMembersService,
    ChatRoomsRepository,
    ChatRoomCodeService,
  ],
  exports: [ChatAccessService, ChatRoomsRepository],
})
export class ChatModule {}
