/**
 * S7-CHAT-FE-3 — hàm THUẦN của badge tổng chưa đọc (SPEC-15 §9 CHAT-SCREEN-006).
 *
 * Tách khỏi component để test bằng gọi hàm. Không có `useQuery`, không có poll: CHAT **không có** route
 * `GET /chat/unread-count` (soát toàn bộ `apps/api/src/chat/*.controller.ts`), và store FE-1 đã đóng đinh
 * hướng này trong docblock `applyIncomingMessage` — badge tổng CỘNG DỒN `unreadCount` từng phòng.
 *
 * Realtime tự có mà không cần listener mới: `chat:message` cộng vào `unreadCount` của phòng,
 * `chat:read` trừ ra (`applyReadEvent`), cả hai đã chạy sẵn ở `useChatRealtime` trên app shell.
 */
import type { ChatRoomDto } from "@mediaos/contracts";

/** Trên ngưỡng này thì hiện "99+" — con số 3 chữ số làm vỡ ô badge tròn. */
export const UNREAD_BADGE_MAX = 99;

/**
 * Tổng tin chưa đọc của MỌI phòng đang hoạt động.
 *
 * ⚠️ Phòng **đã lưu trữ** bị LOẠI, và đây không phải chi tiết vụn vặt. `roomsById` chỉ chứa phòng đã lưu
 * trữ khi người dùng từng bấm "Xem phòng đã lưu trữ" ở `RoomListPanel` (rổ đó hỏi riêng bằng
 * `listRooms({archived:true})`; `listRooms()` mặc định bị service ép `archived:false`). Cộng cả rổ đó thì
 * badge đổi số vì người dùng GHÉ THĂM MỘT TAB chứ không phải vì có tin mới — và phần dôi ra trỏ tới
 * phòng mà dropdown lẫn danh sách mặc định đều không hiện, nên người ta thấy số rồi tìm mãi không ra.
 */
export function totalUnreadCount(roomsById: Readonly<Record<string, ChatRoomDto>>): number {
  let total = 0;
  for (const room of Object.values(roomsById)) {
    if (room.isArchived === true) continue;
    total += room.unreadCount ?? 0;
  }
  return total;
}

/** Nhãn hiển thị trên badge. `>99` ⇒ "99+". Số ≤ 0 ⇒ chuỗi rỗng (call-site không vẽ badge). */
export function formatUnreadBadge(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "";
  return count > UNREAD_BADGE_MAX ? `${UNREAD_BADGE_MAX}+` : String(count);
}

// ── S20-CHAT-UNREAD-1 — mở phòng tại tin chưa đọc đầu tiên (US-CHAT-NV-04, SPEC-15 §13.2) ─────────

/**
 * Khe chừa phía trên vạch khi định vị: vạch dính sát mép trên khung cuộn thì dải ngày dính đỉnh
 * (`sticky top-0` trong `MessageList`) che mất nó.
 */
export const UNREAD_DIVIDER_TOP_GAP_PX = 16;

/**
 * Số trang `beforeSeq` TỐI ĐA được nạp thêm chỉ để với tới mốc chưa đọc. Trang đầu 50 + 4 trang = 250
 * tin. Quá mức đó thì dừng ở tin cũ nhất kèm nhãn «còn tin chưa đọc phía trên» — kéo 1.000 tin về chỉ để
 * mở một phòng là đổi một vạch lấy vài giây trắng màn hình.
 */
export const MAX_UNREAD_CATCHUP_PAGES = 4;

/** Ảnh chụp chưa đọc của MỘT lần mở phòng — chụp TRƯỚC mọi `markRead`, không cập nhật theo store. */
export interface UnreadSnapshot {
  /** `room_seq` của tin chưa đọc đầu tiên = `lastMessageSeq − unreadCount + 1`. */
  firstUnreadSeq: number;
  /** Số hiện trên vạch («N tin chưa đọc»). */
  count: number;
}

/**
 * Suy ảnh chụp từ hai trường đã có của `chatRoomSchema`.
 *
 * `null` = không có gì để đặt vạch ⇒ hành vi cũ (xuống đáy, báo đọc). Gồm cả ca **server cũ** không trả
 * `unreadCount`/`lastMessageSeq` (cả hai `.optional()` — thiếu là `undefined`, không phải ZodError) và
 * ca số liệu vô lý (âm, không nguyên): đặt vạch theo số rác là cuộn tới chỗ sai, tệ hơn không đặt.
 */
export function unreadSnapshotOf(
  room: Pick<ChatRoomDto, "unreadCount" | "lastMessageSeq">,
): UnreadSnapshot | null {
  const count = room.unreadCount;
  const last = room.lastMessageSeq;
  if (typeof count !== "number" || typeof last !== "number") return null;
  if (!Number.isInteger(count) || !Number.isInteger(last) || count <= 0 || last <= 0) return null;
  // `count > last` chỉ xảy ra khi hai số lệch nhịp nhau (WS cộng một bên trước) ⇒ kẹp về tin số 1.
  return { firstUnreadSeq: Math.max(1, last - count + 1), count };
}

/** Phần tối thiểu của một tin mà phép định vị cần — để test không phải dựng cả `StoredChatMessage`. */
export interface UnreadAnchorMessage {
  id: string;
  roomSeq: number;
  recalledAt: string | null;
}

export type UnreadAnchor =
  /** Không đặt vạch: danh sách rỗng, hoặc mọi tin từ mốc trở đi đều đã thu hồi. */
  | { kind: "none" }
  /** Mốc nằm PHÍA TRÊN tin cũ nhất đang giữ và còn được nạp thêm ⇒ chưa đặt vạch, chưa định vị. */
  | { kind: "older-needed" }
  /** Đặt vạch NGAY TRƯỚC `messageId`. `truncated` ⇒ còn tin chưa đọc phía trên chưa nạp tới. */
  | { kind: "message"; messageId: string; truncated: boolean };

/**
 * Vạch đặt trước tin nào.
 *
 * - Tin đầu tiên có `roomSeq ≥ firstUnreadSeq` mà CHƯA thu hồi: tin thu hồi chỉ còn cái vỏ «đã thu hồi»,
 *   đặt vạch trên nó là mời người dùng đọc một ô trống.
 * - So `≥` chứ không `===`: tin đúng mốc có thể đã bị lọc khỏi trang (thu hồi rồi bị bỏ) — vạch rơi
 *   sang tin chưa đọc kế tiếp còn hiển thị.
 * - Mốc ở trên tin cũ nhất: còn nạp được ⇒ `older-needed`; hết đường nạp ⇒ dừng ở tin cũ nhất còn hiển
 *   thị với `truncated`, KHÔNG cuộn tới một chỗ đoán.
 *
 * `messages` phải tăng dần theo `roomSeq` (thứ tự của store).
 */
export function locateUnreadAnchor(
  messages: readonly UnreadAnchorMessage[],
  firstUnreadSeq: number,
  canLoadOlder: boolean,
): UnreadAnchor {
  if (messages.length === 0) return { kind: "none" };
  const truncated = messages[0].roomSeq > firstUnreadSeq;
  if (truncated && canLoadOlder) return { kind: "older-needed" };
  const target = messages.find(
    (m) => m.recalledAt === null && (truncated || m.roomSeq >= firstUnreadSeq),
  );
  return target === undefined
    ? { kind: "none" }
    : { kind: "message", messageId: target.id, truncated };
}

/**
 * Số trên nút «↓ N tin mới» = tin có `roomSeq` sau mốc người dùng ĐÃ THẤY tới (`seenUpToSeq`).
 *
 * Tính bằng hiệu `room_seq` chứ không đếm mảng: khi dừng ở tin cũ nhất (`truncated`), phần chưa đọc
 * chưa nạp vẫn là chưa đọc — đếm mảng sẽ báo thiếu.
 */
export function unseenCountBelow(latestSeq: number | null, seenUpToSeq: number): number {
  if (latestSeq === null || !Number.isFinite(latestSeq)) return 0;
  return Math.max(0, latestSeq - seenUpToSeq);
}
