/**
 * S8-CHAT-UX-FE-2 — vị từ + hằng của **tuỳ chọn phòng PER-USER** (SPEC-15 §10 CHAT-FUNC-015…018).
 *
 * Module THUẦN, không JSX: ba luật dưới đây đều hỏng IM LẶNG nếu để rải trong component, và cả ba chỉ
 * kiểm được đàng hoàng khi gọi trực tiếp bằng hàm — không phải qua DOM.
 *
 * ⚠️ **Ghim HỘI THOẠI (ở đây) ≠ ghim TIN.** `chat_room_members.pinned_at` = ghim một hội thoại lên đầu
 * danh sách, **chỉ mình thấy**, trần 10/người (CHAT-FUNC-016 · CHAT-ERR-021). `chat_messages.pinned_at`
 * = ghim một TIN, cả phòng cùng thấy, trần 20/phòng (CHAT-FUNC-010 · CHAT-ERR-008). Trùng chữ "ghim"
 * nhưng khác bảng, khác trần, khác phạm vi nhìn thấy — SPEC-15 §12 cảnh báo riêng về chỗ này.
 */
import type { ChatRoomDto } from "@mediaos/contracts";

/**
 * Trần ghim hội thoại — ép ở SERVER (`ChatRoomPrefsService`), lặp lại ở đây **chỉ để viết thông điệp**.
 *
 * FE **KHÔNG** chặn trước bằng con số này: đếm ở client là đếm trên rổ phòng đang tải (rổ lưu trữ nằm
 * ngoài, và ghim ở tab khác không phản ánh về đây) ⇒ sẽ chặn oan hoặc cho qua oan. Server là người từ
 * chối; việc của FE là **nói rõ trần là bao nhiêu** khi nhận 409 (CHAT-ERR-021), thay vì "có lỗi xảy ra".
 */
export const ROOM_PIN_LIMIT = 10;

/** Ghim hội thoại là PER-USER: `pinnedAt` server tính trên hàng membership của CHÍNH người gọi. */
export function isRoomPinned(room: ChatRoomDto): boolean {
  return room.pinnedAt !== null && room.pinnedAt !== undefined;
}

/**
 * "Đang tắt thông báo" = `mutedUntil` khác `null` **VÀ** còn ở tương lai.
 *
 * ⚠️ Vế thứ hai KHÔNG thừa. Server chuẩn hoá mốc đã qua về `null` **ở đường ghi**, nhưng một phòng nằm
 * trong store từ 09:00 với `mutedUntil = 10:00` thì đến 10:01 giá trị đó vẫn còn trong RAM tab — không
 * có sự kiện nào phát ra khi một mốc hết hạn. Chỉ kiểm khác-null là vẽ chuông-gạch cho phòng đang gửi
 * thông báo bình thường (đúng cảnh báo trong docblock `chatApi.muteRoom`).
 *
 * `now` truyền vào để test được, mặc định là đồng hồ thật.
 */
export function isRoomMuted(room: ChatRoomDto, now: number = Date.now()): boolean {
  if (room.mutedUntil === null || room.mutedUntil === undefined) return false;
  const until = Date.parse(room.mutedUntil);
  // Mốc rác (server đổi định dạng, dữ liệu cũ) ⇒ coi như KHÔNG tắt: `NaN > now` là `false` nên nhánh này
  // chỉ là lời tuyên bố tường minh — im lặng bật thông báo an toàn hơn im lặng tắt nó.
  return Number.isFinite(until) && until > now;
}

/**
 * Đánh dấu chưa đọc THỦ CÔNG — cột RIÊNG, **không** kéo theo `unreadCount` (SPEC-15 §13.2: `last_read_seq`
 * là con trỏ chỉ-tiến, không được lùi để làm tính năng tiện). Vì thế dòng phòng phải hiện đậm theo cờ này
 * DÙ badge bằng 0; suy trạng thái đậm từ mỗi `unreadCount` là bỏ rơi đúng thứ người dùng vừa bấm.
 */
export function isRoomMarkedUnread(room: ChatRoomDto): boolean {
  return room.markedUnreadAt !== null && room.markedUnreadAt !== undefined;
}

/** Dòng phòng hiện ĐẬM khi có tin chưa đọc HOẶC người dùng tự đánh dấu chưa đọc. */
export function isRoomUnreadLooking(room: ChatRoomDto): boolean {
  return (room.unreadCount ?? 0) > 0 || isRoomMarkedUnread(room);
}

/**
 * Các mốc tắt thông báo mời sẵn.
 *
 * CỐ Ý không có "tắt vĩnh viễn": hợp đồng là `mutedUntil` — một MỐC, và "quá mốc ⇒ tự nhận lại"
 * (CHAT-FUNC-015). Dựng một mốc năm 2099 để giả lập "mãi mãi" là bịa dữ liệu cho khớp một UI mà spec
 * không có, và nó sẽ nằm trong DB lâu hơn cái quyết định đẻ ra nó.
 */
export const MUTE_PRESETS = [
  { key: "1h", ms: 60 * 60 * 1000 },
  { key: "8h", ms: 8 * 60 * 60 * 1000 },
  { key: "1w", ms: 7 * 24 * 60 * 60 * 1000 },
] as const;

export type MutePresetKey = (typeof MUTE_PRESETS)[number]["key"];

/** Mốc ISO của một preset, tính từ `now`. Server tự chuẩn hoá lại nếu đồng hồ client lệch. */
export function mutedUntilFrom(preset: MutePresetKey, now: number = Date.now()): string {
  const found = MUTE_PRESETS.find((p) => p.key === preset);
  // Không có preset ⇒ ném, KHÔNG rơi về một mốc mặc định: "tắt nhầm 1 giờ thay vì 1 tuần" là loại lỗi
  // người dùng không bao giờ quy được về đây.
  if (!found) throw new Error(`[chat] preset tắt thông báo không hợp lệ: ${preset}`);
  return new Date(now + found.ms).toISOString();
}

/**
 * Màu nền của avatar dựng-từ-chữ-cái, suy TẤT ĐỊNH từ `room.id`.
 *
 * Vì sao không dùng màu thương hiệu duy nhất như `Avatar` mặc định: cột trái là một cột dài toàn vòng
 * tròn cùng màu — mắt không neo được vào phòng nào. Màu theo id cho mỗi phòng một dấu hiệu ổn định
 * **qua mọi phiên và mọi thiết bị** (không random, không theo thứ tự trong danh sách — thứ tự đổi mỗi
 * lần có tin mới).
 *
 * Bảng màu lấy từ token Tailwind có sẵn ở CẢ hai theme (`theme.css` của `packages/ui`), không thêm biến
 * mới. Băm là FNV-1a: ổn định, không phụ thuộc `String.prototype.hashCode` (không tồn tại) và không
 * phụ thuộc thứ tự duyệt.
 */
const AVATAR_TONES = [
  "bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-200",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200",
  "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
  "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-200",
  "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-200",
  "bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-200",
] as const;

export function roomAvatarTone(roomId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < roomId.length; i += 1) {
    hash ^= roomId.charCodeAt(i);
    // `Math.imul` giữ phép nhân trong 32-bit — `hash * 16777619` vượt `Number.MAX_SAFE_INTEGER` và mất
    // bit thấp, tức hai id khác nhau có thể ra cùng màu theo kiểu không tái hiện được.
    hash = Math.imul(hash, 0x01000193);
  }
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
}
