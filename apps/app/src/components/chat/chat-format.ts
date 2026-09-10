/**
 * S7-CHAT-FE-2 — hàm THUẦN của trang chat: tên hiển thị · mốc ngày · cỡ tệp · quyền thu hồi · tách liên kết.
 *
 * Tách khỏi component để test bằng gọi hàm (không dựng DOM) và để cùng một luật không có hai bản sao ở
 * trang `/chat` và panel nổi (`S7-CHAT-FE-3` dùng lại nguyên file này).
 */
import { formatDistanceStrict } from "date-fns";
import { vi } from "date-fns/locale";
import type { ChatMessageDto, ChatRoomDto, ChatRoomMemberDto } from "@mediaos/contracts";
import { RECALL_WINDOW_MS } from "@/routes/chat/constants";

/**
 * Tên hiển thị của phòng.
 *
 * `direct` KHÔNG có `name` (mig `0538` DROP NOT NULL) — tên dựng từ NGƯỜI CÒN LẠI.
 *
 * S17-CHAT-UX2-FE-1 — hai nguồn, theo đúng thứ tự này:
 *
 *  1. `members[]` (chỉ có sau `GET /chat/rooms/:id`) — GIỮ ĐẦU, không đảo: `ConversationPanel` truyền
 *     `members` thật và các ca test S7 neo hành vi đó;
 *  2. `room.peer.name` (S17-CHAT-UX2-BE-1) — có NGAY ở danh sách `GET /chat/rooms`, tức DM có tên từ
 *     khung hình đầu. Đây là thứ đã thay thế hẳn cache `resolvedNames` trước đây ở `ChatPage` và
 *     `chat-dock.store`.
 *
 * Hai nguồn cùng suy từ `chat_room_members` nên KHÔNG được phép lệch; nếu lệch thì đó là lỗi BE, không
 * phải chỗ để FE chọn bên. Hết cả hai ⇒ nhãn dự phòng mang MÃ PHÒNG, không bịa tên: nhãn sai làm người
 * dùng nhắn nhầm người.
 */
export function roomDisplayName(
  room: Pick<ChatRoomDto, "name" | "roomType" | "roomCode" | "peer">,
  members: readonly Pick<ChatRoomMemberDto, "userId" | "userName">[] | undefined,
  myUserId: string | null,
  fallback: (code: string) => string,
): string {
  if (room.roomType !== "direct") return room.name ?? fallback(room.roomCode);
  const fromMembers = members?.find((m) => m.userId !== myUserId)?.userName;
  return fromMembers ?? room.peer?.name ?? room.name ?? fallback(room.roomCode);
}

/** Chữ cái đầu cho avatar chữ. Chuỗi rỗng/khoảng trắng ⇒ "?" (không trả chuỗi rỗng làm ô trống). */
export function initialsOf(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  if (trimmed.length === 0) return "?";
  const parts = trimmed.split(/\s+/);
  const last = parts[parts.length - 1];
  return last.slice(0, 1).toUpperCase();
}

/** `HH:mm` theo giờ máy. Mốc không hợp lệ ⇒ chuỗi rỗng (không hiện "Invalid Date" cho người dùng). */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * S7-CHAT-FE-4 — `dd/MM HH:mm` cho những danh sách KHÔNG có dải phân cách ngày: kết quả tìm kiếm và tab
 * Tệp. Ở đó `formatClock` (chỉ `HH:mm`) làm hai dòng cách nhau ba tháng trông y hệt nhau, và người dùng
 * chọn nhầm kết quả vì tưởng nó của hôm nay.
 */
export function formatDateTimeShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}/${month} ${formatClock(iso)}`;
}

/**
 * S17-CHAT-UX2-FE-1 — thời gian TƯƠNG ĐỐI cho dòng phòng ở danh sách («2 ngày», «1 tuần»).
 *
 * Dùng ở cột trái thay `formatClock`: danh sách sắp theo hoạt động và trải dài hàng tháng, nên `HH:mm`
 * làm hai dòng cách nhau ba tháng trông y hệt nhau (cùng lớp lỗi mà `formatDateTimeShort` được dựng ra
 * để chữa ở tab Tệp).
 *
 * `Strict` chứ không phải bản thường: bản thường cho ra «khoảng 1 tháng», «hơn 2 năm» — dài gấp đôi và
 * tràn khỏi cột 320px. Không có hậu tố «trước» vì cột hẹp; ngữ cảnh đã rõ đó là mốc quá khứ.
 *
 * ⚠️ Tính trên đồng hồ MÁY KHÁCH — chấp nhận được vì đây là giá trị TƯƠNG ĐỐI, không phải ngày công của
 * công ty (memory `fe-has-no-company-timezone`). Mốc không hợp lệ ⇒ chuỗi rỗng, không phải "Invalid Date".
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // `formatDistanceStrict(d, now)` chứ KHÔNG `formatDistanceToNowStrict(d)`: bản `ToNow` đọc thẳng
  // `Date.now()` bên trong và bỏ qua mọi tham số — một `now` tiêm vào mà không có tác dụng là chữ ký
  // nói dối, và ca test sẽ phải dịch đồng hồ thật (thứ làm vỡ socket.io ở specs khác của module này —
  // memory `fake-timers-break-socketio-client-emit`). Hai hàm cho ra CÙNG chuỗi khi `now` là hiện tại.
  return formatDistanceStrict(d, now, { locale: vi, addSuffix: false });
}

/** Khoá nhóm-theo-ngày (`YYYY-MM-DD` giờ ĐỊA PHƯƠNG). Không dùng `toISOString` — nó đổi sang UTC ⇒ tin
 * lúc 23:30 rơi sang ngày hôm sau và dải phân cách ngày hiện sai. */
export function dayKeyOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Nhãn dải ngày: Hôm nay / Hôm qua / `dd/MM/yyyy`. `now` tiêm được để test không phụ thuộc đồng hồ. */
export function formatDayLabel(
  iso: string,
  labels: { today: string; yesterday: string },
  now: Date = new Date(),
): string {
  const key = dayKeyOf(iso);
  if (key === "") return "";
  if (key === dayKeyOf(now.toISOString())) return labels.today;
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (key === dayKeyOf(yesterday.toISOString())) return labels.yesterday;
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

const SIZE_UNITS = ["B", "KB", "MB", "GB"] as const;

/** Cỡ tệp người đọc được. Dùng 1024 (khớp cách hệ điều hành hiển thị), 1 chữ số thập phân từ KB trở lên. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${SIZE_UNITS[unit]}`;
}

/**
 * Có được hiện nút "Thu hồi" không (SPEC-15 §13.6) — CHỈ để ẩn/hiện nút.
 *
 * ⚠️ Đây KHÔNG phải cổng quyền. Server mới là cổng (`chat-message-rules.ts`): hàm này chạy trên đồng hồ
 * MÁY KHÁCH, mà đồng hồ máy khách chỉnh được. Người dùng lệch giờ chỉ thấy nút rồi ăn lỗi từ server —
 * đúng thứ tự đó, không phải ngược lại.
 */
export function canRecallMessage(input: {
  message: Pick<ChatMessageDto, "senderId" | "createdAt" | "recalledAt" | "messageType">;
  myUserId: string | null;
  myRole: "member" | "admin" | null;
  roomType: ChatRoomDto["roomType"];
  now?: Date;
}): boolean {
  const { message, myUserId, myRole, roomType } = input;
  // Tin hệ thống không của ai cả — thu hồi nó là vô nghĩa; tin đã thu hồi thì không thu hồi lần hai.
  if (message.recalledAt !== null || message.messageType === "system") return false;
  if (roomType === "group" && myRole === "admin") return true;
  if (myUserId === null || message.senderId !== myUserId) return false;
  const created = new Date(message.createdAt).getTime();
  if (Number.isNaN(created)) return false;
  return (input.now ?? new Date()).getTime() - created <= RECALL_WINDOW_MS;
}

export type TextSegment = { kind: "text" | "link"; value: string };

/**
 * Tách nội dung thành đoạn CHỮ và đoạn LIÊN KẾT.
 *
 * ⚠️ Đây là tầng HIỂN THỊ, không phải tầng sinh HTML. Hàm trả về DỮ LIỆU; component render mỗi đoạn
 * thành text node hoặc `<a>` và React tự escape. Không có `dangerouslySetInnerHTML` ở bất kỳ đâu trong
 * đường tin nhắn — `body` là chuỗi người dùng gõ, và `<img src=x onerror=…>` phải hiện ra dưới dạng CHỮ.
 *
 * Chỉ nhận `http`/`https`. `javascript:` và `data:` KHÔNG khớp regex ⇒ chúng ở lại đoạn chữ, không bao
 * giờ thành `href`. Đây là allowlist, không phải blocklist.
 */
export function splitTextWithLinks(body: string): TextSegment[] {
  if (body.length === 0) return [];
  const pattern = /https?:\/\/[^\s<>"']+/g;
  const out: TextSegment[] = [];
  let cursor = 0;
  for (const match of body.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) out.push({ kind: "text", value: body.slice(cursor, start) });
    // Dấu câu cuối câu thường bị nuốt vào URL ("…xem tại https://a.vn/b." ⇒ href thừa dấu chấm).
    let url = match[0];
    let trailing = "";
    while (url.length > 0 && ".,;:!?)]}".includes(url[url.length - 1])) {
      trailing = url[url.length - 1] + trailing;
      url = url.slice(0, -1);
    }
    if (url.length > 0) out.push({ kind: "link", value: url });
    if (trailing.length > 0) out.push({ kind: "text", value: trailing });
    cursor = start + match[0].length;
  }
  if (cursor < body.length) out.push({ kind: "text", value: body.slice(cursor) });
  return out;
}
