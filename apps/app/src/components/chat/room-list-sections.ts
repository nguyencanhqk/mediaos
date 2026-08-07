/**
 * S8-CHAT-UX-FE-1 — chia danh sách hội thoại thành MỤC CỐ ĐỊNH theo `room_type` (CHAT-DEC-013).
 *
 * Vì sao là module thuần, không nằm trong `RoomListPanel.tsx`: luật "mỗi phòng xuất hiện ĐÚNG một lần"
 * là thứ duy nhất có thể hỏng im lặng ở đây — một phòng lọt hai mục thì React render hai node cùng
 * `key` ở hai `<ul>` anh em và **không cảnh báo gì** (memory `duplicate-sibling-key-leaks-dom-node`).
 * Tách ra để kiểm chứng bằng test trên DỮ LIỆU, không phải trên DOM.
 *
 * ⚠️ **KHÔNG có thư mục tự đặt ở đây.** Owner chốt 05/08/2026 là mục cố định; thư mục tự đặt
 * (Telegram-style) cần 2 bảng + CRUD + kéo-thả và nằm ở wave sau — xem `docs/plans/S8-CHAT-UX-WAVE.md`
 * §2.2. Đừng "tiện tay" nhét vào đây.
 */
import type { ChatRoomDto } from "@mediaos/contracts";
import { isRoomPinned } from "./chat-room-prefs";

/**
 * Thứ tự hiển thị các mục. `pinned` đứng đầu vì đó là lý do người ta ghim.
 *
 * 4 khoá còn lại TRÙNG TÊN với `ChatRoomDto.roomType` — cố ý, để `buildRoomSections` phân loại bằng
 * chính giá trị đó thay vì một bảng ánh xạ thứ hai phải giữ đồng bộ bằng tay.
 */
export const ROOM_SECTION_KEYS = ["pinned", "direct", "group", "department", "project"] as const;

export type RoomSectionKey = (typeof ROOM_SECTION_KEYS)[number];

export interface RoomSection {
  /**
   * Thường là một giá trị của `ROOM_SECTION_KEYS`. Kiểu để RỘNG (string) có chủ ý: nếu server thêm
   * `room_type` thứ năm mà FE chưa biết, phòng đó phải rơi vào một mục lạ **và vẫn hiện ra** — chứ
   * không được biến mất khỏi danh sách. Mất phòng trong im lặng tệ hơn nhiều so với một tiêu đề xấu.
   */
  key: string;
  rooms: ChatRoomDto[];
  /** Tổng tin chưa đọc của cả mục — cần khi mục đang THU để dấu vết chưa đọc không mất theo. */
  unreadTotal: number;
}

/** Vị từ "phòng này có đang được TÔI ghim không". */
export type IsRoomPinned = (room: ChatRoomDto) => boolean;

/**
 * S8-CHAT-UX-FE-2 — vị từ THẬT đã nối (FE-1 để tạm `NEVER_PINNED` vì cột `pinned_at` chưa tồn tại).
 *
 * Mặc định trỏ thẳng `isRoomPinned` (`chat-room-prefs.ts`) chứ không nhân bản phép so sánh ở đây: cùng
 * một câu hỏi "phòng này có đang được TÔI ghim không" được hỏi ở CẢ mục danh sách LẪN nhãn menu ngữ
 * cảnh, và hai bản luật lệch nhau sẽ cho ra menu ghi "Bỏ ghim" trên một phòng nằm ngoài mục Đã ghim.
 *
 * Tham số `isPinned` GIỮ LẠI (không bỏ) để test chia rổ vẫn tiêm được vị từ giả — luật "ghim thắng loại
 * phòng" phải kiểm được mà không phải dựng `ChatRoomDto` đủ khoá.
 */
const DEFAULT_IS_PINNED: IsRoomPinned = isRoomPinned;

/**
 * Gom phòng vào mục, GIỮ NGUYÊN thứ tự đầu vào bên trong mỗi mục.
 *
 * Thứ tự đầu vào là `roomOrder` của store (mới nhất trước) — hàm này chỉ chia rổ, KHÔNG sắp xếp lại.
 * Mục rỗng bị loại khỏi kết quả để `RoomListPanel` không phải tự lọc lần nữa.
 */
export function buildRoomSections(
  rooms: readonly ChatRoomDto[],
  isPinned: IsRoomPinned = DEFAULT_IS_PINNED,
): RoomSection[] {
  const buckets = new Map<string, ChatRoomDto[]>();

  for (const room of rooms) {
    // Ghim THẮNG loại phòng — nếu không, một phòng nhóm đã ghim sẽ nằm ở cả `pinned` lẫn `group`.
    const key = isPinned(room) ? "pinned" : room.roomType;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(room);
    else buckets.set(key, [room]);
  }

  const known: RoomSection[] = [];
  for (const key of ROOM_SECTION_KEYS) {
    const bucket = buckets.get(key);
    if (bucket && bucket.length > 0) known.push(toSection(key, bucket));
    buckets.delete(key);
  }

  // Khoá lạ (server thêm loại phòng mới) xuống cuối, KHÔNG bị bỏ rơi. Xem docblock `RoomSection.key`.
  const unknown = [...buckets.entries()]
    .filter(([, bucket]) => bucket.length > 0)
    .map(([key, bucket]) => toSection(key, bucket));

  return [...known, ...unknown];
}

function toSection(key: string, rooms: ChatRoomDto[]): RoomSection {
  return {
    key,
    rooms,
    unreadTotal: rooms.reduce((sum, room) => sum + (room.unreadCount ?? 0), 0),
  };
}

// ─── Trạng thái thu/mở (nhớ giữa các phiên) ──────────────────────────────────────────────────────

const COLLAPSED_STORAGE_PREFIX = "mediaos.chat.roomSections.collapsed";

/**
 * Khoá lưu kèm `userId`: một máy có thể được nhiều người đăng nhập lần lượt, và "mục nào đang thu" là
 * tuỳ chọn cá nhân — dùng chung khoá thì người sau thừa hưởng bố cục của người trước.
 */
export function collapsedStorageKey(userId: string | null | undefined): string {
  return `${COLLAPSED_STORAGE_PREFIX}.${userId ?? "anonymous"}`;
}

/**
 * `localStorage` NÉM trong vài trường hợp thật (Safari chế độ riêng tư, storage bị chính sách chặn) và
 * nội dung có thể là rác do phiên bản cũ để lại. Cả hai chỉ được phép làm mất TUỲ CHỌN HIỂN THỊ — không
 * bao giờ được làm hỏng danh sách hội thoại. Vì vậy mọi lỗi ở đây nuốt về "mở hết".
 */
export function readCollapsedSections(storageKey: string): Record<string, boolean> {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(([, v]) => typeof v === "boolean"),
    ) as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function writeCollapsedSections(
  storageKey: string,
  collapsed: Readonly<Record<string, boolean>>,
): void {
  try {
    globalThis.localStorage?.setItem(storageKey, JSON.stringify(collapsed));
  } catch {
    // Không nhớ được tuỳ chọn thì thôi — không có gì để báo cho người dùng ở đây.
  }
}
