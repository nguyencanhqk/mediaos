import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../db/db.service";
import type { FilePermissionInput } from "../foundation/files/file-policy.types";
import type { FileOwnerPermissionResolver } from "../foundation/files/resolvers/file-owner-permission-resolver";
import { PermissionService } from "../permission/permission.service";
import { ChatAccessService } from "./chat-access.service";
import { CHAT_ROOM_AVATAR_ENTITY_TYPE } from "./chat-file.constants";
import { CHAT_MODULE_CODE } from "./chat.errors";

/**
 * Cặp quyền đường ĐỌC avatar phòng — **TRÙNG NGUYÊN VĂN** cặp của đường đọc PHÒNG
 * (`ChatRoomsController.listRooms`/`getRoom`), y như `ChatMessageFileResolver` làm với đường đọc tin.
 *
 * `data_scope` là per-(permission, role): tách một cặp riêng cho ảnh sẽ đẻ ra role "thấy phòng mà không
 * tải được ảnh của nó" — hoặc ngược lại (`read-path-gate-pair-must-match-download-pair`).
 */
const CHAT_READ_PAIR = { action: "view", resourceType: "chat-room" } as const;

/**
 * S8-CHAT-UX-BE-2 — `ChatRoomAvatarFileResolver` (`(CHAT, chat_room_avatar)`).
 *
 * ┌─ VÌ SAO BẮT BUỘC ─────────────────────────────────────────────────────────────────────────────┐
 * │ `FilePolicyService.decideForLinkedFile` FAIL-CLOSED: cặp `(moduleCode, entityType)` chưa đăng ký │
 * │ resolver trả thẳng `deny-no-resolver` và **KHÔNG** escalate xuống fallback `FOUNDATION.FILE.*`.  │
 * │ Thiếu đăng ký ⇒ đặt được avatar mà **không ai tải được**, kể cả người vừa đặt — tính năng chết   │
 * │ trong im lặng, đúng lỗi đã ship thật ở `S5-BRAND-BE-1`. Có ca test gỡ `registerResolver` để      │
 * │ chứng minh tính chất này là THẬT chứ không phải suy đoán.                                        │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * MÔ HÌNH QUYỀN — `entityId` của mọi link ở đây là **`chat_rooms.id`** (KHÁC `chat_message` dùng
 * `chat_messages.id`; đó là toàn bộ lý do hai loại phải có `entity_type` riêng):
 *
 *   VIEW / DOWNLOAD  ⇐ `view:chat-room` **VÀ** actor là thành viên ĐANG hoạt động của phòng
 *   LINK             ⇐ **KHÔNG BAO GIỜ** — xem dưới
 *   UNLINK / DELETE  ⇐ **KHÔNG BAO GIỜ** — xem dưới
 *
 * ⚠️ KHÔNG viết lại điều kiện membership ở đây: `ChatAccessService.assertMember` là điểm khẳng định
 * DUY NHẤT của module (`module-closed-by-second-assert-not-scope`). Resolver chỉ đổi `NotFoundException`
 * thành `false` vì hợp đồng của policy layer là boolean.
 */
@Injectable()
export class ChatRoomAvatarFileResolver implements FileOwnerPermissionResolver {
  readonly moduleCode = CHAT_MODULE_CODE;
  readonly entityTypes: readonly string[] = [CHAT_ROOM_AVATAR_ENTITY_TYPE];

  constructor(
    private readonly db: DatabaseService,
    private readonly permission: PermissionService,
    private readonly access: ChatAccessService,
  ) {}

  canViewFile(input: FilePermissionInput): Promise<boolean> {
    return this.canRead(input);
  }

  canDownloadFile(input: FilePermissionInput): Promise<boolean> {
    return this.canRead(input);
  }

  /**
   * LINK: **luôn `false`**.
   *
   * Đường gắn avatar hợp lệ DUY NHẤT là `POST /chat/rooms/:id/avatar`, nơi `ChatRoomAvatarService` ép
   * trọn bộ luật `CHAT-DEC-016` + chống IDOR (`owner_user_id === actor`) + `image/*` + trạng thái tệp.
   * `POST /foundation/files/:id/links` là ĐƯỜNG GHI THỨ HAI **không chịu bất kỳ luật nào trong số đó**;
   * cho nó qua là để người giữ `link:foundation-file` (seed = company-admin, mig `0005`) gắn ảnh bất kỳ
   * — kể cả tệp của người khác — làm bộ mặt của một phòng họ không thuộc.
   *
   * Khác `ChatMessageFileResolver.canLinkFile` (nó PHẢI mở vì đính kèm có luồng FOUNDATION hợp lệ):
   * avatar phòng **không có** luồng thứ hai nào cần mở.
   */
  canLinkFile(): Promise<boolean> {
    return Promise.resolve(false);
  }

  /**
   * UNLINK / DELETE: **luôn `false`**.
   *
   * Gỡ link phải đi qua `DELETE /chat/rooms/:id/avatar` để cột `avatar_file_id` và hàng `file_links`
   * luôn thay đổi CÙNG một transaction. Gỡ lẻ qua FOUNDATION để lại cột trỏ vào một link đã chết ⇒
   * `ChatRoomAvatarPresignService` im lặng trả về "không có ảnh" mà không ai sửa được qua API.
   *
   * ⚠️ Phải khai TƯỜNG MINH chứ không bỏ trống: hai method này OPTIONAL trên interface, và resolver
   * không cài thì policy layer rơi xuống fallback `FOUNDATION.FILE.UNLINK`/`DELETE` — cặp mà
   * company-admin ĐANG giữ (bulk grant `0005`).
   */
  canUnlinkFile(): Promise<boolean> {
    return Promise.resolve(false);
  }

  canDeleteFile(): Promise<boolean> {
    return Promise.resolve(false);
  }

  /**
   * ĐỌC = cặp `view:chat-room` **VÀ** actor là thành viên đang hoạt động của phòng.
   *
   * ⚠️ `await` ở vế thứ hai không phải chi tiết văn phong: so một **Promise** với `null` luôn `true` —
   * đúng lỗi mà `ChatMessageFileResolver` ghi lại. Unit spec "không phải thành viên → từ chối" là thứ
   * bắt được.
   */
  private async canRead(input: FilePermissionInput): Promise<boolean> {
    const decision = await this.permission.can({
      userId: input.userId,
      companyId: input.companyId,
      action: CHAT_READ_PAIR.action,
      resourceType: CHAT_READ_PAIR.resourceType,
    });
    if (!decision.allow) return false;
    return await this.isRoomMember(input);
  }

  /**
   * Nuốt ĐÚNG 404 (hằng của `ChatAccessService`); mọi lỗi khác ném tiếp để `decideViaResolver` biến
   * thành `deny-error` CÓ LOG. Nuốt trắng mọi exception là biến một sự cố DB thật thành "không có
   * quyền" trong im lặng (silent-failure-hunter).
   */
  private async isRoomMember(input: FilePermissionInput): Promise<boolean> {
    try {
      await this.db.withTenant(input.companyId, (tx) =>
        this.access.assertMember(tx, input.companyId, input.entityId, input.userId),
      );
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }
}

/**
 * Nhận diện 404 mà KHÔNG `instanceof NotFoundException`: `withTenant` có thể bọc lại lỗi, và ở worker
 * vitest hai bản `@nestjs/common` khác instance làm `instanceof` trượt trong im lặng ⇒ `deny-error`
 * thay vì deny sạch. Soi `getStatus()` là bất biến qua mọi cách bọc. (Bản sao có chủ đích của helper
 * cùng tên ở `chat-message-file.resolver.ts` — gộp lại là bài dọn riêng, không phải việc của WO này.)
 */
function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const candidate = err as { getStatus?: unknown; status?: unknown };
  if (typeof candidate.getStatus === "function") {
    return (candidate.getStatus as () => number)() === 404;
  }
  return candidate.status === 404;
}
