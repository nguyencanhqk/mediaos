import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { chatMessages, chatRoomMembers, chatRooms } from "../db/schema/communication";

/**
 * S7-CHAT-BE-GATE-2 — **BẢN SAO DUY NHẤT** của vị từ "lịch sử trước khi tham gia" (SPEC-15 §13.4).
 *
 * ┌─ VAI TRÒ CỦA `chat_room_members.visible_from_seq` — ĐỌC TRƯỚC KHI SỬA ────────────────────────┐
 * │ • v1 cột LUÔN NULL (CHAT-DEC-008 · mig `0538:238,243` · `0539:63`). KHÔNG writer nào được set │
 * │   nó — kể cả `S7-CHAT-BE-5` (đồng bộ phòng dẫn xuất): người vào phòng ban/dự án đọc TOÀN BỘ    │
 * │   lịch sử, đó là tiêu chí nghiệm thu SPEC-15 §20 mục 3.                                        │
 * │ • Cột tồn tại để phase sau bật "chỉ đọc từ lúc vào" bằng ĐÚNG một câu UPDATE, không migration  │
 * │   đổi hình dạng bảng và **không phải đi audit lại từng đường đọc**. Điều kiện để lời hứa đó có │
 * │   giá trị: MỌI đường đọc tin phải mang sẵn vị từ NGAY TỪ v1 (SPEC-15 §13.4 câu cuối).          │
 * │ • Vì cột luôn NULL, mọi hàm ở file này là **NO-OP về hành vi ở v1**. Test đơn vị không phân    │
 * │   biệt được "có vị từ" với "không có vị từ" trên dữ liệu v1 — đó chính là lý do vị từ phải     │
 * │   nằm ở MỘT chỗ và được kiểm bằng SQL đã render (`chat-visibility.spec.ts`), chứ không đi      │
 * │   kiểm bằng cách gọi API rồi nhìn kết quả.                                                     │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **HỆ QUY CHIẾU LÀ `room_seq`, KHÔNG PHẢI `seq`.** SPEC-15 §13.4 và mig `0538:245` viết
 * `msg.seq >= m.visible_from_seq` — câu đó có TRƯỚC `S7-CHAT-DB-2` (mig `0539`). `chat_messages.seq` là
 * identity CẤP BẢNG, tăng xuyên mọi phòng và mọi tenant; đem so với một mốc per-room là cắt nhầm lịch sử
 * ở một điểm ngẫu nhiên (và lệch dần theo lưu lượng của các phòng khác). `visible_from_seq` sống trong
 * hệ `room_seq` — cùng hệ với `last_read_seq`, `last_message_seq`, `beforeSeq`/`afterSeq`.
 *
 * ⚠️ **HAI ĐƯỜNG ĐỌC CỐ Ý KHÔNG MANG VỊ TỪ NÀY** — đừng "hoàn thiện" chúng:
 *   • `countPinned` — đếm trần 20 tin ghim là bất biến của PHÒNG (CHAT-ERR-008), không phải của người
 *     đang nhìn. Lọc theo `visible_from_seq` sẽ cho hai người cùng phòng đếm ra hai con số khác nhau và
 *     phá trần trong im lặng.
 *   • `findByClientMessageId` — tra idempotency, đã bound theo `senderId = actor`. Tin của chính mình
 *     không thể nằm trước mốc mình vào phòng.
 */

/**
 * Vị từ dạng SCALAR — dùng khi caller ĐÃ cầm hàng membership (kết quả `assertMember` /
 * `assertMessageAccess`) nên không cần join lại `chat_room_members`.
 *
 * Trả `undefined` khi cột NULL (v1) để caller bỏ hẳn điều kiện khỏi `WHERE` thay vì sinh
 * `... OR NULL` — Postgres không loại được vế NULL khỏi kế hoạch, còn `undefined` thì drizzle bỏ luôn.
 *
 * @param visibleFromSeq `membership.visibleFromSeq` — KHÔNG được tự bịa, phải lấy từ điểm khẳng định.
 */
export function visibleFromSeqScalar(visibleFromSeq: number | null): SQL | undefined {
  if (visibleFromSeq === null) return undefined;
  return sql`${chatMessages.roomSeq} >= ${visibleFromSeq}`;
}

/**
 * Vị từ dạng CỘT — dùng khi truy vấn đã join `chat_room_members` và không có sẵn giá trị ở JS
 * (`ChatAccessService.assertMessageAccess`: một truy vấn duy nhất, membership và tin nhắn lấy cùng lúc).
 *
 * Viết đủ vế `IS NULL OR` chứ không `COALESCE(visible_from_seq, 0)`: mốc hợp lệ nhỏ nhất là `1`
 * (`room_seq` liên tục từ 1 — `0539`), nên `0` "tình cờ" tương đương NULL hôm nay và sẽ NGỪNG tương
 * đương nếu ai đó đổi gốc đánh số. Vế `IS NULL` nói đúng ý định, không dựa vào trùng hợp số học.
 */
export function visibleFromSeqColumn(): SQL {
  return sql`(${chatRoomMembers.visibleFromSeq} IS NULL OR ${chatMessages.roomSeq} >= ${chatRoomMembers.visibleFromSeq})`;
}

/**
 * Số tin CHƯA ĐỌC của một hàng `(chat_rooms × chat_room_members)` — dùng chung bởi CHAT-API-001
 * (`listRoomsForUser`) và CHAT-API-016 (`unreadTotals`). Trước GATE-2 công thức này bị chép ở HAI nơi;
 * hai bản sao của một công thức đếm là hai bản sao sẽ trôi.
 *
 * ```text
 * unread = GREATEST(0, last_message_seq − GREATEST(last_read_seq, visible_from_seq − 1))
 * ```
 *
 * Sàn `visible_from_seq − 1` là chỗ vị từ §13.4 sống trong phép TRỪ: tin nhìn thấy được nằm trong
 * `[V, last]`, đã đọc tới `L`, nên chưa đọc = `(max(L, V−1), last]`. Thiếu sàn này thì badge của người
 * mới vào phòng đếm cả phần lịch sử họ **không mở ra được** — con số không bao giờ về 0 vì không có
 * thao tác nào của họ đẩy con trỏ qua được đoạn đó.
 *
 * `COALESCE(visible_from_seq, 0) − 1` = `−1` khi cột NULL ⇒ `GREATEST(last_read_seq, −1)` =
 * `last_read_seq` (CHECK `chk_chat_members_read_seq` ép `>= 0`) ⇒ **v1 ra đúng con số cũ, từng bit**.
 *
 * ⚠️ Phép kẹp nằm TRONG SQL, không ở JS (bài học `clamp-must-be-sql-not-js`): tính ở JS thì hai request
 * song song đọc-rồi-ghi và bên ghi sau thắng kể cả khi nó mang số nhỏ hơn.
 */
export function unreadSeqExpr(): SQL<number> {
  return sql<number>`greatest(0, coalesce(${chatRooms.lastMessageSeq}, 0) - greatest(${chatRoomMembers.lastReadSeq}, coalesce(${chatRoomMembers.visibleFromSeq}, 0) - 1))`;
}
