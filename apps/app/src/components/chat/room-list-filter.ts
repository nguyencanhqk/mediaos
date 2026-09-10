/**
 * S17-CHAT-UX2-FE-1 — chip lọc nhanh của cột trái (CHAT-DEC-021 · SPEC-15 §9a).
 *
 * Vì sao là module thuần chứ không `useMemo` trong `RoomListPanel`: bất biến **«mỗi phòng xuất hiện
 * ĐÚNG một lần trên MỌI chip»** chỉ kiểm được trên DỮ LIỆU. Trên DOM thì hai node cùng `key` ở hai `<ul>`
 * anh em **không cảnh báo gì** (memory `duplicate-sibling-key-leaks-dom-node`) — đúng lý do
 * `room-list-sections.ts` của S8 cũng đứng riêng.
 *
 * ⚠️ Chip **KHÔNG đảo** mục cố định CHAT-DEC-014: «Tất cả» giữ nguyên 5 mục (Đã ghim đứng đầu, ghim
 * THẮNG loại phòng). Mọi chip khác là danh sách **PHẲNG theo hoạt động** — không chia mục con, và ghim
 * KHÔNG được đẩy phòng lên đầu. Đó là nguyên văn §9a, không phải chỗ để "cải tiến".
 */
import type { ChatRoomDto } from "@mediaos/contracts";
import { isRoomUnreadLooking } from "./chat-room-prefs";

/**
 * Thứ tự LÀ thứ tự hiển thị (wireframe §05). `all` đứng đầu vì đó là mặc định mỗi lần vào màn hình.
 *
 * `deptproject` gộp hai `room_type` vào MỘT chip có chủ ý: phòng ban và dự án đều là phòng **dẫn xuất**
 * (thành viên do hệ thống đồng bộ, không ai tự thêm), nên với người dùng chúng là cùng một loại việc.
 */
export const ROOM_FILTER_CHIPS = [
  "all",
  "unread",
  "direct",
  "group",
  "deptproject",
  "archived",
] as const;

export type RoomFilterChip = (typeof ROOM_FILTER_CHIPS)[number];

/** Chip mặc định. §9a: chip **không lưu** — mỗi lần vào lại màn hình đều quay về đây. */
export const DEFAULT_ROOM_FILTER_CHIP: RoomFilterChip = "all";

/**
 * `archived` là một RỔ DỮ LIỆU khác (`listRooms({archived:true})`), không phải một vị từ trên rổ mặc
 * định — `listRooms()` không tham số bị service ép `archived: false`, nên phòng đã lưu trữ **không có**
 * trong rổ thường (docblock `syncRoomList`).
 *
 * Tách thành vị từ riêng để `RoomListPanel` chỉ hỏi MỘT câu ("chip này cần rổ nào") thay vì rải phép so
 * sánh `chip === "archived"` ở bốn chỗ rồi bỏ sót chỗ thứ năm.
 */
export function chipNeedsArchivedScope(chip: RoomFilterChip): boolean {
  return chip === "archived";
}

/** «Tất cả» là chip DUY NHẤT giữ mục cố định; mọi chip khác ra danh sách phẳng. */
export function chipUsesSections(chip: RoomFilterChip): boolean {
  return chip === "all";
}

/**
 * Lọc theo chip. **GIỮ NGUYÊN thứ tự đầu vào** — `roomOrder` của store đã sắp theo hoạt động
 * (`lastMessageAt`), và §9a nói "phẳng theo hoạt động", không phải "phẳng có ghim lên đầu".
 *
 * Đầu vào PHẢI đã được lọc theo rổ lưu trữ ở cấp trên (xem `chipNeedsArchivedScope`): trộn hai rổ làm
 * một phòng xuất hiện ở hai chip với hai trạng thái khác nhau, và người dùng không lần được vì sao.
 *
 * ⚠️ `unread` dùng LẠI `isRoomUnreadLooking`, KHÔNG viết lại `(unreadCount ?? 0) > 0`. `markedUnreadAt`
 * (đánh dấu chưa đọc thủ công — CHAT-FUNC-017) **cố ý không** đổi `unreadCount` vì `last_read_seq` là con
 * trỏ chỉ-tiến (§13.2). Một bản luật thứ hai ở đây sẽ giấu đúng phòng người dùng vừa tự đánh dấu, trong
 * khi dòng của nó vẫn đang in ĐẬM ngay trước mắt họ.
 */
export function filterRoomsByChip(
  rooms: readonly ChatRoomDto[],
  chip: RoomFilterChip,
): ChatRoomDto[] {
  switch (chip) {
    // Hai chip này KHÔNG lọc thêm gì: rổ đã đúng từ cấp trên (`all` = rổ thường, `archived` = rổ lưu trữ).
    case "all":
    case "archived":
      return [...rooms];
    case "unread":
      return rooms.filter((room) => isRoomUnreadLooking(room));
    case "direct":
    case "group":
      return rooms.filter((room) => room.roomType === chip);
    case "deptproject":
      return rooms.filter((room) => room.roomType === "department" || room.roomType === "project");
  }
}
