import { ConflictException, Injectable } from "@nestjs/common";
import type { ChatMuteRoomRequest, ChatRoomDto } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { ChatAccessService } from "./chat-access.service";
import { ChatRoomsRepository } from "./chat-rooms.repository";
import type { ChatActor } from "./chat-rooms.service";
import { CHAT_ERR } from "./chat.errors";
import { unreadOf } from "./chat-room-rules";
import { toChatRoomDto } from "./chat.mapper";

/**
 * Trần ghim HỘI THOẠI — **10 / NGƯỜI** (SPEC-15 §5.1b · CHAT-FUNC-016 · CHAT-DEC-015).
 *
 * ⚠️ KHÔNG nhầm với trần 20 tin ghim / PHÒNG (`CHAT_PIN_LIMIT`, CHAT-ERR-008): khác bảng, khác phạm vi
 * nhìn thấy, khác mã lỗi. SPEC-15 §12 có hẳn ghi chú cảnh báo cặp trùng chữ "ghim" này.
 *
 * Trần ép ở SERVICE chứ không ở DB (mig `0543` khối (A) ghi rõ lý do): ràng buộc "đếm ≤ 10" cần
 * trigger hoặc exclusion constraint, đắt hơn giá trị nó mang — nhưng service PHẢI cầm khoá advisory,
 * xem `ChatRoomsRepository.lockUserPrefs`.
 */
export const CHAT_ROOM_PIN_MAX = 10;

/**
 * S8-CHAT-UX-BE-1 — tuỳ chọn per-phòng của MỘT NGƯỜI: ghim (CHAT-API-024a/b) · tắt thông báo
 * (CHAT-API-025) · đánh dấu chưa đọc (CHAT-API-020).
 *
 * ┌─ VÌ SAO TÁCH KHỎI `ChatRoomsService` ─────────────────────────────────────────────────────────┐
 * │ Ba hành động này KHÁC CHẤT với phần còn lại của module: chúng ghi lên hàng `chat_room_members`  │
 * │ CỦA CHÍNH actor, không đụng dữ liệu dùng chung. Hệ quả — và đây là điều phải giữ khi sửa file  │
 * │ này về sau:                                                                                    │
 * │   • KHÔNG `requireRoomAdmin` / `assertManualEdit`: ghim một phòng phòng-ban là việc của bất kỳ │
 * │     thành viên nào; bắt phải là admin phòng làm tính năng chết ở `department`/`project` (hai   │
 * │     loại đó có **0 admin** — `chat-derived-rooms-sync.service.ts` không gán `role='admin'` lần  │
 * │     nào). Đây cũng là tinh thần memory `personal-prefs-must-not-sit-behind-permission-gate`.    │
 * │   • KHÔNG chặn ở phòng ĐÃ LƯU TRỮ: phòng lưu trữ vẫn hiện trong danh sách `archived=true` và    │
 * │     vẫn đẩy badge; không cho tắt thông báo/bỏ ghim ở đó là nhốt người dùng với một dòng phòng   │
 * │     họ không tắt được (cùng lý do `leaveRoom` cố ý cho rời phòng đã lưu trữ).                   │
 * │   • KHÔNG audit: xem docblock `CHAT_AUDIT` — `audit_logs` là bảng append-only DÙNG CHUNG đang    │
 * │     phục vụ điều tra AUTH/HR/LEAVE. Ba thao tác bật/tắt hiển thị của một người trên chính hàng  │
 * │     của họ, đảo ngược bằng một cú bấm, không tác động tới ai — audit chúng là nhiễu. Cùng lý do │
 * │     `CHAT-API-023` (typing) và đường gửi/đọc tin đều 0 audit.                                   │
 * │   • KHÔNG phát WS: `chat:room` nhắm cả phòng, mà ba giá trị này chỉ đúng với MỘT người. Phát    │
 * │     chúng ra là rò "ai đã tắt thông báo của ai" cho cả phòng. Đa-thiết-bị đồng bộ bằng lần      │
 * │     `GET /chat/rooms` kế tiếp — đúng như `unreadCount` (bị `wsChatRoomEventSchema` strip).      │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * MỌI hành động vẫn đi qua `ChatAccessService.assertMember` ⇒ phòng lạ / phòng không thuộc / đã rời
 * đều là **404 giống hệt nhau** (CHAT-ERR-001). 403 ở đây sẽ xác nhận phòng có tồn tại — oracle dò.
 */
@Injectable()
export class ChatRoomPrefsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ChatRoomsRepository,
    private readonly access: ChatAccessService,
  ) {}

  /**
   * CHAT-API-024a — ghim hội thoại. **Idempotent**: ghim một phòng đang ghim trả 200 và KHÔNG tiêu thêm
   * một suất (nhánh `alreadyPinned` thoát trước khi đếm).
   *
   * @throws ConflictException (409 · CHAT-ERR-021) khi đã ghim đủ `CHAT_ROOM_PIN_MAX` phòng KHÁC.
   */
  async pin(actor: ChatActor, roomId: string): Promise<ChatRoomDto> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const acc = await this.access.assertMember(tx, actor.companyId, roomId, actor.id);
      if (acc.membership.pinnedAt) return this.dtoOf(acc, { pinnedAt: acc.membership.pinnedAt });

      // Khoá TRƯỚC khi đếm, và chỉ ở nhánh ghim. Đếm-rồi-ghi không có khoá là đường đua ⇒ 11 phòng;
      // lý do đầy đủ (kể cả vì sao subquery trong UPDATE không cứu được) ở `lockUserPrefs`.
      await this.repo.lockUserPrefs(tx, actor.companyId, actor.id);
      const pinned = await this.repo.countPinnedRooms(tx, actor.companyId, actor.id);
      if (pinned >= CHAT_ROOM_PIN_MAX) {
        throw new ConflictException(CHAT_ERR.ROOM_PIN_LIMIT(CHAT_ROOM_PIN_MAX));
      }

      const pinnedAt = await this.repo.setRoomPinned(
        tx,
        actor.companyId,
        acc.membership.id,
        new Date(),
      );
      return this.dtoOf(acc, { pinnedAt });
    });
  }

  /** CHAT-API-024b — bỏ ghim. Idempotent (bỏ ghim phòng chưa ghim = 200). KHÔNG cần khoá: số đếm giảm. */
  async unpin(actor: ChatActor, roomId: string): Promise<ChatRoomDto> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const acc = await this.access.assertMember(tx, actor.companyId, roomId, actor.id);
      const pinnedAt = await this.repo.setRoomPinned(tx, actor.companyId, acc.membership.id, null);
      return this.dtoOf(acc, { pinnedAt });
    });
  }

  /**
   * CHAT-API-025 — tắt/bật thông báo phòng (CHAT-FUNC-015). `mutedUntil: null` = BẬT LẠI.
   *
   * ┌─ MỐC ĐÃ QUA ⇒ CHUẨN HOÁ VỀ `null`, KHÔNG ném lỗi ────────────────────────────────────────────┐
   * │ Đường ĐỌC (`ChatAudienceReader.stillReceiving`) coi `muted_until <= now()` là **không tắt**.  │
   * │ Lưu nguyên một mốc quá khứ nghĩa là DB giữ một giá trị mà chính hệ thống đọc là "không tắt" — │
   * │ và FE nào kiểm `mutedUntil !== null` sẽ vẽ chuông-gạch cho một phòng đang gửi thông báo bình  │
   * │ thường (đúng lớp `ui-promises-backend-never-reads`, chỉ đảo chiều). Chuẩn hoá tại đường ghi   │
   * │ làm trạng thái DB khớp hành vi đường đọc.                                                     │
   * │ KHÔNG chọn "ném 422" vì lệch đồng hồ client vài giây sẽ biến một thao tác hợp lệ thành lỗi.   │
   * └───────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠️ Đối với FE: mốc **hết hạn trong lúc dữ liệu nằm trong cache**. Kiểm `mutedUntil !== null` là
   * chưa đủ — phải so với thời điểm hiện tại (`mutedUntil > now`) mới ra đúng "đang tắt hay không".
   */
  async mute(actor: ChatActor, roomId: string, dto: ChatMuteRoomRequest): Promise<ChatRoomDto> {
    const wanted = dto.mutedUntil === null ? null : new Date(dto.mutedUntil);
    const normalized = wanted !== null && wanted.getTime() > Date.now() ? wanted : null;

    return this.db.withTenant(actor.companyId, async (tx) => {
      const acc = await this.access.assertMember(tx, actor.companyId, roomId, actor.id);
      const mutedUntil = await this.repo.setRoomMuted(
        tx,
        actor.companyId,
        acc.membership.id,
        normalized,
      );
      return this.dtoOf(acc, { mutedUntil });
    });
  }

  /**
   * CHAT-API-020 — đánh dấu chưa đọc THỦ CÔNG (CHAT-FUNC-017).
   *
   * ⚠️ Ghi cột RIÊNG `marked_unread_at`. TUYỆT ĐỐI KHÔNG hiện thực bằng cách lùi `last_read_seq`:
   * con trỏ chỉ-tiến là bất biến SPEC-15 §13.2 (CHAT-ERR-018) và mọi phép đếm chưa đọc dựng trên nó.
   * Vì thế `unreadCount` trả về ở đây **không đổi** — đó là hành vi ĐÚNG, không phải thiếu sót: cờ là
   * tín hiệu hiển thị độc lập, FE hiện đậm dòng phòng khi `markedUnreadAt !== null` dù badge bằng 0.
   *
   * Cờ được xoá ở MỘT chỗ duy nhất: `advanceLastReadSeq` (CHAT-API-014, "mở phòng ⇒ về NULL").
   */
  async markUnread(actor: ChatActor, roomId: string): Promise<ChatRoomDto> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const acc = await this.access.assertMember(tx, actor.companyId, roomId, actor.id);
      const markedUnreadAt = await this.repo.setRoomMarkedUnread(
        tx,
        actor.companyId,
        acc.membership.id,
        new Date(),
      );
      return this.dtoOf(acc, { markedUnreadAt });
    });
  }

  // ─── nội bộ ──────────────────────────────────────────────────────────────────

  /**
   * DTO phòng sau khi ghi, dựng từ hàng `assertMember` ĐÃ đọc + đúng một cột vừa đổi.
   *
   * Không đọc lại DB: `assertMember` chạy trong CÙNG transaction nên hai cột không đổi vẫn là giá trị
   * mới nhất, và cột vừa ghi lấy thẳng từ `RETURNING`. Đọc lại là một round-trip thừa cho 0 thông tin.
   */
  private dtoOf(
    acc: Awaited<ReturnType<ChatAccessService["assertMember"]>>,
    patch: Partial<{ pinnedAt: Date | null; mutedUntil: Date | null; markedUnreadAt: Date | null }>,
  ): ChatRoomDto {
    return toChatRoomDto(acc.room, unreadOf(acc.room.lastMessageSeq, acc.membership.lastReadSeq), {
      pinnedAt: acc.membership.pinnedAt,
      mutedUntil: acc.membership.mutedUntil,
      markedUnreadAt: acc.membership.markedUnreadAt,
      ...patch,
    });
  }
}
