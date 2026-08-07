import { and, eq } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { chatRooms } from "../db/schema/communication";
import type { ChatRoomType } from "../db/schema/communication";

/** Đúng những cột `chat_rooms` mà luật CHAT-DEC-016 cần đọc — không hơn. */
export interface ChatRoomAvatarRow {
  id: string;
  roomType: ChatRoomType;
  /** Neo phòng DỰ ÁN (`chk_chat_rooms_type_anchor`, mig `0538:116`). */
  refId: string | null;
  /** Neo phòng PHÒNG BAN — KHÁC `refId`. Nhầm hai cột này là gate luôn 403 (hoặc luôn cho qua). */
  orgUnitId: string | null;
  isArchived: boolean;
  avatarFileId: string | null;
}

/**
 * S8-CHAT-UX-BE-2 — data-access của avatar phòng. Repo RIÊNG (không thêm hàm vào `ChatRoomsRepository`):
 * file đó là hot-file của cả module, và WO này chỉ cần đúng hai câu.
 *
 * ⚠️ QUYỀN GHI: `chat_rooms` **KHÔNG có UPDATE cấp bảng** từ mig `0540` — chỉ 11 cột được GRANT, cộng
 * `avatar_file_id` do `0543:105` cấp thêm. Câu `set()` dưới đây chạm đúng 3 cột đều đã có GRANT
 * (`avatar_file_id`, `updated_at`, `updated_by`); thêm cột thứ tư mà quên GRANT là **42501 lúc chạy**,
 * không phải lúc build, không lint nào bắt (`grant-in-old-migration-is-not-current-state`).
 */
export class ChatRoomAvatarRepository {
  /**
   * Khoá hàng phòng (`FOR UPDATE`) rồi trả đúng các cột quyết định.
   *
   * `FOR UPDATE` **không phải trang trí**: hai người cùng đủ tư cách bấm "đổi ảnh" cùng lúc sẽ ghi đè
   * nhau, và cái thua để lại một `file_links` sống trỏ vào file không còn là avatar — tức một grant tải
   * vô hình tồn tại mãi. Khoá ở đây serialise cả cặp (soft-delete link cũ → set cột) trong một tx.
   *
   * KHÔNG lọc `deleted_at`/membership: caller ĐÃ đi qua `ChatAccessService.assertMember` (404 hằng).
   * Thêm vế ở đây là dựng điểm khẳng định membership thứ hai — thứ `chat-access.service.ts` cấm.
   */
  async findRoomForAvatarTx(
    tx: TenantTx,
    companyId: string,
    roomId: string,
  ): Promise<ChatRoomAvatarRow | undefined> {
    const rows = await tx
      .select({
        id: chatRooms.id,
        roomType: chatRooms.roomType,
        refId: chatRooms.refId,
        orgUnitId: chatRooms.orgUnitId,
        isArchived: chatRooms.isArchived,
        avatarFileId: chatRooms.avatarFileId,
      })
      .from(chatRooms)
      .where(and(eq(chatRooms.companyId, companyId), eq(chatRooms.id, roomId)))
      .limit(1)
      .for("update");

    const row = rows[0];
    return row ? { ...row, roomType: row.roomType as ChatRoomType } : undefined;
  }

  /** `fileId = null` ⇒ gỡ avatar. `updated_by` ghi người thật — job đối soát KHÔNG đi qua đường này. */
  async updateAvatarFileIdTx(
    tx: TenantTx,
    companyId: string,
    roomId: string,
    fileId: string | null,
    actorUserId: string,
  ): Promise<void> {
    await tx
      .update(chatRooms)
      .set({ avatarFileId: fileId, updatedAt: new Date(), updatedBy: actorUserId })
      .where(and(eq(chatRooms.companyId, companyId), eq(chatRooms.id, roomId)));
  }
}
