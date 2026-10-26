/**
 * S20-CHAT-SEENBY-1 (US-CHAT-QL-03) — «Đã xem · Chưa xem» của MỘT tin, suy THUẦN từ dữ liệu FE đã có.
 *
 * Nguồn: `members[].lastReadSeq` (con trỏ đọc trong hệ `room_seq`, SPEC-15 §13.2) + `joinedAt`/`leftAt`.
 * Không endpoint, không bảng mới: bảng chỉ sắp lại thứ mỗi thành viên vốn đã thấy trong phòng.
 *
 * Người nhận của tin = thành viên KHÁC tôi, đang ở trong phòng, và đã vào phòng KHÔNG SAU lúc gửi
 * (`joinedAt > createdAt` ⇒ loại). Người vào sau bị loại khỏi CẢ HAI tab, không chỉ «Chưa xem»: con trỏ
 * đọc của họ có thể đã vượt tin chỉ vì họ mở phòng sau khi vào — đó không phải bằng chứng họ đọc tin này,
 * và đếm họ vào «Đã xem» làm hai số không cộng lại thành số người nhận.
 *
 * `joinedAt` không đọc được (chuỗi rỗng ở dữ liệu cũ) ⇒ KHÔNG loại: thiếu dữ liệu không phải bằng chứng
 * vào sau. Không có trường thời điểm đọc nào ở đây — luật §3.2-6: trạng thái đọc là dữ liệu hành vi.
 */
import type { ChatRoomMemberDto } from "@mediaos/contracts";
import type { SeenByViewer } from "./SeenByAvatars";

/** Trạng thái nguồn `members` do trang truyền xuống — chưa `ready` thì KHÔNG vẽ danh sách nào. */
export type SeenByRosterStatus = "loading" | "error" | "ready";

export interface SeenByStatus {
  seen: SeenByViewer[];
  unseen: SeenByViewer[];
}

export interface SeenByInput {
  members: readonly ChatRoomMemberDto[];
  myUserId: string | null;
  message: { roomSeq: number; createdAt: string };
  avatarByUser?: ReadonlyMap<string, string | null>;
}

/**
 * Trạng thái roster từ query chi tiết phòng (`chatKeys.rooms.detail`). Lỗi THẮNG dữ liệu cũ: lần làm tươi
 * hỏng (gồm 404 đồng nhất sau khi tôi rời phòng) thì `data` cũ vẫn còn trong cache — vẽ tiếp danh sách từ
 * đó là đúng thứ «danh sách sai» bảng phải tránh.
 */
export function rosterStatusOf(query: { data: unknown; isError: boolean }): SeenByRosterStatus {
  if (query.isError) return "error";
  return query.data === undefined ? "loading" : "ready";
}

function joinedAfter(joinedAt: string, createdAt: string): boolean {
  const joined = Date.parse(joinedAt);
  const sent = Date.parse(createdAt);
  // NaN ở bất kỳ vế nào ⇒ phép so sánh là `false` ⇒ không loại.
  return joined > sent;
}

export function seenByStatusOf({
  members,
  myUserId,
  message,
  avatarByUser,
}: SeenByInput): SeenByStatus {
  // Chưa biết «tôi» là ai thì không tách được «người khác» — rỗng còn hơn đoán.
  if (myUserId === null) return { seen: [], unseen: [] };

  const seen: SeenByViewer[] = [];
  const unseen: SeenByViewer[] = [];
  for (const m of members) {
    if (m.userId === myUserId) continue;
    if (m.leftAt) continue;
    if (joinedAfter(m.joinedAt, message.createdAt)) continue;

    const viewer: SeenByViewer = {
      userId: m.userId,
      name: m.userName ?? null,
      avatarUrl: avatarByUser?.get(m.userId) ?? null,
    };
    const hasRead = m.lastReadSeq !== undefined && m.lastReadSeq >= message.roomSeq;
    (hasRead ? seen : unseen).push(viewer);
  }
  return { seen, unseen };
}
