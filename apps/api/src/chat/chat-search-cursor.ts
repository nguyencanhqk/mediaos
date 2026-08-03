import { BadRequestException } from "@nestjs/common";
import { CHAT_ERR } from "./chat.errors";

/**
 * S7-CHAT-BE-4 — con trỏ phân trang của `GET /chat/search`. Hàm THUẦN, không phụ thuộc Nest/DB.
 *
 * ┌─ VÌ SAO KHOÁ LÀ `(created_at, id)` CHỨ KHÔNG PHẢI MỘT SỐ THỨ TỰ ────────────────────────────────┐
 * │ • `offset` — trôi khi có tin mới chèn vào giữa lúc cuộn (API-13 §6.4). Cấm toàn module.          │
 * │ • `room_seq` — PER-ROOM (mig `0539`). Trộn nhiều phòng thì hai tin khác phòng có cùng số ⇒ con   │
 * │   trỏ cắt nhầm.                                                                                  │
 * │ • `chat_messages.seq` — identity CẤP BẢNG, tăng xuyên mọi phòng và mọi tenant. Phơi ra là **rò   │
 * │   lưu lượng toàn công ty**: hai lần tìm cách nhau một giờ, hiệu số `seq` cho biết công ty gửi bao │
 * │   nhiêu tin. Đây đúng là lỗ mà `S7-CHAT-DB-2` vừa bịt — mở lại nó qua ô search là đi lùi.        │
 * │                                                                                                  │
 * │ `created_at` và `id` thì ĐÃ nằm sẵn trong DTO tin nhắn ⇒ con trỏ không phơi thông tin mới.       │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ VÌ SAO CẮT VỀ MILI-GIÂY — ĐỌC TRƯỚC KHI "DỌN" ────────────────────────────────────────────────┐
 * │ `chat_messages.created_at` là `timestamptz`: Postgres lưu **micro-giây**. JS `Date` chỉ giữ tới  │
 * │ **mili-giây**. Nếu sắp xếp theo `created_at` THÔ mà con trỏ chỉ mang mili-giây thì hai tin cách  │
 * │ nhau 300µs trong cùng một mili-giây làm vế `(created_at, id) < ($ms, $id)` loại LUÔN những hàng  │
 * │ cũ hơn nằm trong chính mili-giây đó ⇒ trang sau **sót tin, HTTP 200, không lỗi**.                 │
 * │                                                                                                  │
 * │ Vì vậy khoá sắp xếp là `date_trunc('milliseconds', created_at)` — BẰNG ĐÚNG độ chính xác con trỏ │
 * │ mang được, nên phép so sánh toàn phần trở lại. Cặp `(trunc(created_at), id)` vẫn toàn phần vì    │
 * │ `id` là UUID PK.                                                                                 │
 * │                                                                                                  │
 * │ ⚠️ Fixture gieo trong MỘT transaction có `now()` bằng nhau từng bit ⇒ ca phân trang thường KHÔNG │
 * │ tái hiện được lỗi này. Ca đóng đinh nó phải gieo bằng `directPool` với `created_at` lệch 1µs.    │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Mã hoá **opaque** (base64url) không phải để bảo mật — con trỏ chỉ chứa dữ liệu người gọi đã thấy. Nó để
 * client KHÔNG tự chế con trỏ rồi phụ thuộc vào hình dạng nội bộ. Server vẫn validate đầy đủ.
 */
export interface ChatSearchCursor {
  /** Mốc thời gian ĐÃ cắt về mili-giây, dạng ISO-8601 UTC (`…THH:mm:ss.sssZ`). */
  sortAt: Date;
  /** `chat_messages.id` của hàng cuối trang trước — vế phá hoà của khoá. */
  id: string;
}

const SEPARATOR = "|";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * ⚠️ KHÔNG thêm hàm `truncateToMillisecond` ở phía JS. Bản đầu có nó và nó là **no-op**:
 * `new Date(at.getTime())` không cắt được gì dưới mili-giây vì `Date` vốn CHỈ có mili-giây. Tên hàm hứa
 * một bảo đảm mà thân hàm không cấp — mời người sau tin rằng việc cắt đã làm ở JS. Bảo đảm THẬT nằm ở
 * `date_trunc('milliseconds', …)` trong SQL (`chat-search.repository.ts`), vì phần µs chỉ tồn tại ở
 * Postgres và biến mất ngay khi giá trị đi qua `Date`.
 */

/**
 * Con trỏ opaque cho hàng cuối của trang. `null` khi không còn trang sau — caller quyết định điều đó
 * bằng cách lấy `limit + 1` hàng rồi xem hàng thừa có tồn tại không.
 */
export function encodeChatSearchCursor(cursor: ChatSearchCursor): string {
  const payload = `${cursor.sortAt.toISOString()}${SEPARATOR}${cursor.id}`;
  return Buffer.from(payload, "utf8").toString("base64url");
}

/**
 * Giải mã + validate. Hỏng ở BẤT KỲ vế nào → **400**, KHÔNG im lặng rơi về trang đầu: rơi về trang đầu
 * biến một con trỏ hỏng thành vòng lặp vô hạn ở FE (trang 2 luôn trả trang 1).
 *
 * Dùng mã lỗi RIÊNG, KHÔNG tái dùng `CURSOR_EXCLUSIVE` — mã đó nói về `beforeSeq`/`afterSeq` của
 * `/messages`, sai nghĩa ở đây.
 */
export function decodeChatSearchCursor(raw: string): ChatSearchCursor {
  const invalid = (): never => {
    throw new BadRequestException(CHAT_ERR.SEARCH_CURSOR_INVALID);
  };

  let payload = "";
  try {
    payload = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    invalid();
  }

  const at = payload.indexOf(SEPARATOR);
  if (at <= 0) invalid();
  const isoPart = payload.slice(0, at);
  const idPart = payload.slice(at + SEPARATOR.length);

  if (!UUID_RE.test(idPart)) invalid();

  const parsed = new Date(isoPart);
  if (Number.isNaN(parsed.getTime())) invalid();
  // Vòng khứ hồi phải TRÙNG NGUYÊN VĂN: chặn `"2026-08-03"` hay `"…T01:02:03Z"` (thiếu mili-giây) lọt
  // qua `new Date()` rồi so lệch với khoá sắp xếp đã cắt-về-mili-giây.
  if (parsed.toISOString() !== isoPart) invalid();

  return { sortAt: parsed, id: idPart };
}
